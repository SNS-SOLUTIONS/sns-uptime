const { log } = require("../src/util");

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
     * @returns {void}
     */

    /**
     * Wrapper to create a `Prometheus` instance and ensure metrics are initialized.
     * @param {Monitor} monitor Monitor object to monitor
     * @returns {Promise<Prometheus>} `Prometheus` instance
     */

    /**
     * Creates a prometheus metric instance.
     *
     * Note: Make sure to call `Prometheus.initMetrics()` once prior creating Prometheus instances.
     * @param {Monitor} monitor Monitor object to monitor
     * @param {Promise<LooseObject<any>[]>} tags Tags of the monitor
     */
    constructor(monitor, tags) {
        this.monitorLabelValues = {
            monitor_name: monitor.name,
            monitor_type: monitor.type,
            monitor_url: monitor.url,
            monitor_hostname: monitor.hostname,
            monitor_port: monitor.port
        };
        Object.values(tags)
            // only label names that were known at first metric creation.
            .filter(tag => Prometheus.monitorLabelNames.includes(tag.name))
            .forEach(tag => {
                this.monitorLabelValues[tag.name] = tag.value;
            });
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
