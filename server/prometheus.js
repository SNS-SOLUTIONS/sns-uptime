const { R } = require("redbean-node");
const PrometheusClient = require("prom-client");
const { log } = require("../src/util");

const commonLabels = [
    "monitor_name",
    "monitor_type",
    "monitor_url",
    "monitor_hostname",
    "monitor_port",
];

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
        return new Prometheus(monitor, tags);
    }

    /**
     * Creates a prometheus metric instance.
     *
     * Note: Make sure to call `Prometheus.initMetrics()` once prior creating Prometheus instances.
     * @param {Monitor} monitor Monitor object to monitor
     * @param {LooseObject<any>[]} tags Tags of the monitor (none if omitted)
     */
    constructor(monitor, tags = []) {
        this.monitorLabelValues = {
            monitor_name: monitor.name,
            monitor_type: monitor.type,
            monitor_url: monitor.url,
            monitor_hostname: monitor.hostname,
            monitor_port: monitor.port
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
                Prometheus.monitorCertIsValid.set(this.monitorLabelValues, isValid);
            } catch (e) {
                log.error("prometheus", "Caught error");
                log.error("prometheus", e);
            }

            try {
                if (tlsInfo.certInfo != null) {
                    Prometheus.monitorCertDaysRemaining.set(this.monitorLabelValues, tlsInfo.certInfo.daysRemaining);
                }
            } catch (e) {
                log.error("prometheus", "Caught error");
                log.error("prometheus", e);
            }
        }

        if (heartbeat) {
            try {
                Prometheus.monitorStatus.set(this.monitorLabelValues, heartbeat.status);
            } catch (e) {
                log.error("prometheus", "Caught error");
                log.error("prometheus", e);
            }

            try {
                if (typeof heartbeat.ping === "number") {
                    Prometheus.monitorResponseTime.set(this.monitorLabelValues, heartbeat.ping);
                } else {
                    // Is it good?
                    Prometheus.monitorResponseTime.set(this.monitorLabelValues, -1);
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
        try {
            Prometheus.monitorCertDaysRemaining?.remove(this.monitorLabelValues);
            Prometheus.monitorCertIsValid?.remove(this.monitorLabelValues);
            Prometheus.monitorResponseTime?.remove(this.monitorLabelValues);
            Prometheus.monitorStatus?.remove(this.monitorLabelValues);
        } catch (e) {
            console.error(e);
        }
    }
}

module.exports = {
    Prometheus
};
