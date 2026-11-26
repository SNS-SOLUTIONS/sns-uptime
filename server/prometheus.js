const { R } = require("redbean-node");
const PrometheusClient = require("prom-client");
const { log } = require("../src/util");

const commonLabels = [
    "monitor_name",
    "monitor_type",
    "monitor_url",
    "monitor_hostname",
    "monitor_port",
    // Place of the monitor in the tree (see Prometheus.getPlacement()): its agency and its folder
    "monitor_agency",
    "monitor_group",
];

/**
 * Deepest nesting walked up when looking for the agency of a monitor. Far beyond any real tree: it only stops
 * a corrupted one, as does the check against cycles (the editor refuses them, a database edited by hand may
 * still hold one).
 */
const MAX_DEPTH = 32;

/**
 * Group directly above a monitor, read in the database: same join as Monitor.getParent(), limited to the
 * columns the placement needs.
 * @param {number} monitorID ID of the monitor
 * @returns {Promise<LooseObject<any>|null>} The parent, or null at the root
 */
async function getParentRow(monitorID) {
    return await R.getRow(`
        SELECT parent.id, parent.name, parent.type, parent.agency
        FROM monitor parent
        JOIN monitor child ON child.parent = parent.id
        WHERE child.id = ?
    `, [ monitorID ]);
}

/**
 * Key of a set of label values, whatever the order of its labels.
 * @param {object} labels Label values
 * @returns {string} Key
 */
function labelKey(labels) {
    return JSON.stringify(Object.keys(labels).sort().map(name => [ name, labels[name] ?? null ]));
}

/**
 * Turn a tag name into a valid Prometheus label name ([a-zA-Z_][a-zA-Z0-9_]*): accents removed, any other
 * character replaced by "_", leading characters dropped until a letter ("Agence Lyon" -> "Agence_Lyon",
 * "Priorité" -> "Priorite"). prom-client refuses any other label name, and the first refused name would make
 * every metric fail.
 * @param {string} name Tag name
 * @returns {string} Label name, or "" when nothing usable is left
 */
function toLabelName(name) {
    return String(name ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/^[^a-zA-Z]+/, "");
}

class Prometheus {

    /**
     * Metric: monitor_cert_days_remaining
     * @type {PrometheusClient.Gauge<string> | null}
     */
    static monitorCertDaysRemaining = null;

    /**
     * Metric: monitor_cert_is_valid
     * @type {PrometheusClient.Gauge<string> | null}
     */
    static monitorCertIsValid = null;

    /**
     * Metric: monitor_response_time
     * @type {PrometheusClient.Gauge<string> | null}
     */
    static monitorResponseTime = null;

    /**
     * Metric: monitor_status
     * @type {PrometheusClient.Gauge<string> | null}
     */
    static monitorStatus = null;

    /**
     * All registered metric labels.
     * @type {string[] | null}
     */
    static monitorLabelNames = null;

    /**
     * Last value written to each metric, by set of label values. When the labels of a running monitor change
     * (one of its groups renamed, moved or deleted), its values move to the new labels: the monitor never
     * leaves /metrics in between. Every writer counts, the monitor itself as well as the push route.
     * @type {Map<string, Map<PrometheusClient.Gauge<string>, number>>}
     */
    static lastValues = new Map();

    /**
     * Monitor labels/values combination.
     * @type {{}}
     */
    monitorLabelValues;

    /**
     * Initialize metrics and get all label names the first time called.
     * Tags created afterwards only become labels after a restart.
     * @returns {Promise<void>}
     */
    static async initMetrics() {
        if (!this.monitorLabelNames) {
            let tagNames = await R.getCol("SELECT name FROM tag");
            let tagLabels = tagNames
                .map(toLabelName)
                .filter(label => label !== "" && !commonLabels.includes(label));
            // Two tags can give the same label once cleaned ("Agence Lyon", "Agence-Lyon"): keep it once.
            this.monitorLabelNames = [ ...new Set([ ...commonLabels, ...tagLabels ]) ];
        }
        if (!this.monitorCertDaysRemaining) {
            this.monitorCertDaysRemaining = new PrometheusClient.Gauge({
                name: "monitor_cert_days_remaining",
                help: "The number of days remaining until the certificate expires",
                labelNames: this.monitorLabelNames
            });
        }
        if (!this.monitorCertIsValid) {
            this.monitorCertIsValid = new PrometheusClient.Gauge({
                name: "monitor_cert_is_valid",
                help: "Is the certificate still valid? (1 = Yes, 0 = No)",
                labelNames: this.monitorLabelNames
            });
        }
        if (!this.monitorResponseTime) {
            this.monitorResponseTime = new PrometheusClient.Gauge({
                name: "monitor_response_time",
                help: "Monitor Response Time (ms)",
                labelNames: this.monitorLabelNames
            });
        }
        if (!this.monitorStatus) {
            this.monitorStatus = new PrometheusClient.Gauge({
                name: "monitor_status",
                help: "Monitor Status (1 = UP, 0 = DOWN, 2 = PENDING, 3 = MAINTENANCE)",
                labelNames: this.monitorLabelNames
            });
        }
    }

    /**
     * Wrapper to create a `Prometheus` instance and ensure metrics are initialized.
     * @param {Monitor} monitor Monitor object to monitor
     * @returns {Promise<Prometheus>} `Prometheus` instance
     */
    static async createAndInitMetrics(monitor) {
        await Prometheus.initMetrics();
        let tags = await monitor.getTags();
        let placement = await Prometheus.getPlacement(monitor.id);
        return new Prometheus(monitor, tags, placement);
    }

    /**
     * Where a monitor is filed, read by walking up its groups in the database rather than from the monitor in
     * memory, whose parent may be outdated (deleting a group unlinks its children in the database only):
     * - agency: name of the closest group above it that is an agency, "" if there is none;
     * - group: name of its folder, the group directly above it, "" at the root or when that group is the
     *   agency itself.
     * A group gets its own placement, read from the groups above it. Read when the metrics of the monitor are
     * created: a group renamed or moved afterwards is followed by Monitor.refreshPrometheusLabels().
     * @param {number} monitorID ID of the monitor
     * @returns {Promise<{agency: string, group: string}>} Agency and folder names
     */
    static async getPlacement(monitorID) {
        const placement = {
            agency: "",
            group: "",
        };
        const visited = new Set([ monitorID ]);
        let parent = await getParentRow(monitorID);

        for (let depth = 0; parent && !visited.has(parent.id) && depth < MAX_DEPTH; depth++) {
            visited.add(parent.id);
            if (parent.type === "group" && Boolean(parent.agency)) {
                placement.agency = parent.name ?? "";
                break;
            }
            if (depth === 0) {
                placement.group = parent.name ?? "";
            }
            parent = await getParentRow(parent.id);
        }

        return placement;
    }

    /**
     * Creates a prometheus metric instance.
     *
     * Note: Make sure to call `Prometheus.initMetrics()` once prior creating Prometheus instances.
     * @param {Monitor} monitor Monitor object to monitor
     * @param {LooseObject<any>[]} tags Tags of the monitor (none if omitted)
     * @param {{agency?: string, group?: string}} placement Agency and folder of the monitor, from
     * getPlacement() (none if omitted)
     */
    constructor(monitor, tags = [], placement = {}) {
        this.monitorLabelValues = {
            monitor_name: monitor.name,
            monitor_type: monitor.type,
            monitor_url: monitor.url,
            monitor_hostname: monitor.hostname,
            monitor_port: monitor.port,
            monitor_agency: placement?.agency ?? "",
            monitor_group: placement?.group ?? "",
        };
        for (const tag of Object.values(tags ?? [])) {
            const label = toLabelName(tag.name);
            // only label names that were known at first metric creation.
            if (label !== "" && !commonLabels.includes(label) && Prometheus.monitorLabelNames?.includes(label)) {
                this.monitorLabelValues[label] = tag.value ?? "";
            }
        }
    }

    /**
     * Write one metric of the monitor, and remember the value for moveTo().
     * @param {PrometheusClient.Gauge<string>} gauge Metric
     * @param {number} value Value
     * @returns {void}
     */
    write(gauge, value) {
        gauge.set(this.monitorLabelValues, value);
        const key = labelKey(this.monitorLabelValues);
        if (!Prometheus.lastValues.has(key)) {
            Prometheus.lastValues.set(key, new Map());
        }
        Prometheus.lastValues.get(key).set(gauge, value);
    }

    /**
     * Update the metrics page
     * @param {object} heartbeat Heartbeat details
     * @param {object} tlsInfo TLS details
     * @returns {void}
     */
    update(heartbeat, tlsInfo) {
        if (typeof tlsInfo !== "undefined") {
            try {
                let isValid;
                if (tlsInfo.valid === true) {
                    isValid = 1;
                } else {
                    isValid = 0;
                }
                this.write(Prometheus.monitorCertIsValid, isValid);
            } catch (e) {
                log.error("prometheus", "Caught error");
                log.error("prometheus", e);
            }

            try {
                if (tlsInfo.certInfo != null) {
                    this.write(Prometheus.monitorCertDaysRemaining, tlsInfo.certInfo.daysRemaining);
                }
            } catch (e) {
                log.error("prometheus", "Caught error");
                log.error("prometheus", e);
            }
        }

        if (heartbeat) {
            try {
                this.write(Prometheus.monitorStatus, heartbeat.status);
            } catch (e) {
                log.error("prometheus", "Caught error");
                log.error("prometheus", e);
            }

            try {
                if (typeof heartbeat.ping === "number") {
                    this.write(Prometheus.monitorResponseTime, heartbeat.ping);
                } else {
                    // Is it good?
                    this.write(Prometheus.monitorResponseTime, -1);
                }
            } catch (e) {
                log.error("prometheus", "Caught error");
                log.error("prometheus", e);
            }
        }
    }

    /**
     * Remove monitor from prometheus
     * @returns {void}
     */
    remove() {
        Prometheus.lastValues.delete(labelKey(this.monitorLabelValues));
        try {
            Prometheus.monitorCertDaysRemaining?.remove(this.monitorLabelValues);
            Prometheus.monitorCertIsValid?.remove(this.monitorLabelValues);
            Prometheus.monitorResponseTime?.remove(this.monitorLabelValues);
            Prometheus.monitorStatus?.remove(this.monitorLabelValues);
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Hand the metrics of the monitor over to `next`, the same monitor under new label values (one of its
     * groups was renamed, moved or deleted): the old series go and the last values written are set again under
     * the new labels, in one go (no scrape in between), so that the monitor stays in /metrics until its next
     * heartbeat. Old series first: the labels may well be the same.
     * @param {Prometheus} next Instance holding the new label values
     * @returns {Prometheus} `next`
     */
    moveTo(next) {
        const values = Prometheus.lastValues.get(labelKey(this.monitorLabelValues)) ?? new Map();
        this.remove();
        for (const [ gauge, value ] of values) {
            try {
                next.write(gauge, value);
            } catch (e) {
                log.error("prometheus", "Caught error");
                log.error("prometheus", e);
            }
        }
        return next;
    }
}

module.exports = {
    Prometheus
};
