const { R } = require("redbean-node");
const dayjs = require("dayjs");
const { log, DOWN, PENDING, SQL_DATETIME_FORMAT } = require("../src/util");
const { UptimeKumaServer } = require("./uptime-kuma-server");
const { setting } = require("./util-server");
const { Notification } = require("./notification");

/**
 * Acknowledging an incident says "someone is on it": the repeated down
 * notifications stop until the monitor recovers, the whole team can see who
 * took it, and that person is told personally once it is back up.
 */
class Acknowledgement {

    /**
     * Get the acknowledgement currently covering a monitor
     * @param {number} monitorID ID of the monitor
     * @returns {Promise<(Bean|null)>} Active acknowledgement, if any
     */
    static async getActive(monitorID) {
        return R.findOne("monitor_acknowledgement", " monitor_id = ? AND cleared_date IS NULL ", [
            monitorID,
        ]);
    }

    /**
     * @param {number} monitorID ID of the monitor
     * @returns {Promise<boolean>} Is someone already handling this incident?
     */
    static async isAcknowledged(monitorID) {
        return await Acknowledgement.getActive(monitorID) !== null;
    }

    /**
     * Shape an acknowledgement for the browser
     * @param {Bean} bean Acknowledgement to convert
     * @returns {object} Plain object safe to send to the client
     */
    static toJSON(bean) {
        return {
            monitorID: bean.monitor_id,
            username: bean.username,
            displayName: bean.display_name || bean.username,
            email: bean.email || null,
            createdDate: bean.created_date,
        };
    }

    /**
     * List every active acknowledgement of the monitors owned by a user
     * @param {number} userID ID of the user
     * @returns {Promise<object>} Acknowledgements keyed by monitor ID
     */
    static async listByUserID(userID) {
        const list = await R.getAll(`
            SELECT monitor_acknowledgement.*
            FROM monitor_acknowledgement
            JOIN monitor ON monitor.id = monitor_acknowledgement.monitor_id
            WHERE monitor.user_id = ? AND monitor_acknowledgement.cleared_date IS NULL
        `, [ userID ]);

        const result = {};

        for (const row of list) {
            result[row.monitor_id] = Acknowledgement.toJSON(row);
        }

        return result;
    }

    /**
     * Push the current acknowledgements to every session of a user
     * @param {Server} io Socket.io server instance
     * @param {number} userID ID of the user owning the monitors
     * @returns {Promise<object>} What was sent
     */
    static async sendList(io, userID) {
        const result = await Acknowledgement.listByUserID(userID);
        io.to(userID).emit("acknowledgementList", result);
        return result;
    }

    /**
     * Take responsibility for an ongoing incident
     * @param {number} monitorID ID of the monitor to acknowledge
     * @param {object} profile Identity of the person taking it
     * @returns {Promise<Bean>} The acknowledgement, existing or newly created
     * @throws {Error} The monitor is not in an incident
     */
    static async acknowledge(monitorID, profile) {
        const existing = await Acknowledgement.getActive(monitorID);

        if (existing) {
            return existing;
        }

        const heartbeat = await R.findOne("heartbeat", " monitor_id = ? ORDER BY time DESC ", [
            monitorID,
        ]);

        if (!heartbeat || (heartbeat.status !== DOWN && heartbeat.status !== PENDING)) {
            throw new Error("Only a monitor that is currently down can be acknowledged.");
        }

        const bean = R.dispense("monitor_acknowledgement");
        bean.monitor_id = monitorID;
        bean.username = profile?.username || null;
        bean.display_name = profile?.displayName || profile?.username || null;
        bean.email = profile?.email || null;
        bean.created_date = R.isoDateTime(dayjs.utc());

        await R.store(bean);

        log.info("acknowledgement", `Monitor #${monitorID} acknowledged by ${bean.display_name || "unknown"}`);

        return bean;
    }

    /**
     * Drop the acknowledgement of a monitor, without warning anyone
     * @param {number} monitorID ID of the monitor
     * @returns {Promise<(Bean|null)>} The acknowledgement that was cleared, if there was one
     */
    static async clear(monitorID) {
        const bean = await Acknowledgement.getActive(monitorID);

        if (!bean) {
            return null;
        }

        bean.cleared_date = R.isoDateTime(dayjs.utc());
        await R.store(bean);

        return bean;
    }

    /**
     * The monitor is back up: close the acknowledgement and tell the person who
     * took it, since they are the one waiting for the outcome.
     * @param {Monitor} monitor Monitor that recovered
     * @param {Bean} heartbeat Heartbeat that brought it back up
     * @param {Server} io Socket.io server instance, to refresh the dashboards
     * @returns {Promise<void>}
     */
    static async resolve(monitor, heartbeat, io) {
        const bean = await Acknowledgement.clear(monitor.id);

        if (!bean) {
            return;
        }

        log.info("acknowledgement", `Monitor #${monitor.id} recovered, acknowledgement by ${bean.display_name || "unknown"} closed`);

        await Acknowledgement.sendList(io, monitor.user_id);
        await Acknowledgement.notifyAcknowledger(bean, monitor, heartbeat);
    }

    /**
     * Send the recovery mail to the person who acknowledged the incident. The
     * transport is an existing SMTP notification, only the recipient changes,
     * so nothing else has to be configured twice.
     * @param {Bean} bean Acknowledgement being closed
     * @param {Monitor} monitor Monitor that recovered
     * @param {Bean} heartbeat Heartbeat that brought it back up
     * @returns {Promise<void>}
     */
    static async notifyAcknowledger(bean, monitor, heartbeat) {
        if (!bean.email) {
            return;
        }

        const notificationID = await setting("acknowledgementNotificationID");

        if (!notificationID) {
            log.debug("acknowledgement", "No notification chosen to reach the person who acknowledged, skipping");
            return;
        }

        const notification = await R.findOne("notification", " id = ? ", [ notificationID ]);

        if (!notification) {
            log.warn("acknowledgement", `Notification #${notificationID} no longer exists, cannot reach ${bean.email}`);
            return;
        }

        let config;

        try {
            config = JSON.parse(notification.config);
        } catch (e) {
            log.warn("acknowledgement", `Notification #${notificationID} has an unreadable configuration`);
            return;
        }

        if (config.type !== "smtp") {
            log.warn("acknowledgement", `Notification #${notificationID} is not an SMTP one, cannot redirect it to ${bean.email}`);
            return;
        }

        // Same server and sender, but addressed to the person who took the incident
        config = {
            ...config,
            smtpTo: bean.email,
            smtpCC: "",
            smtpBCC: "",
        };

        const msg = `[${monitor.name}] [✅ Up] ${heartbeat.msg}`;

        // Same enrichment as a regular notification, so the mail templates work
        const heartbeatJSON = heartbeat.toJSON();
        const server = UptimeKumaServer.getInstance();
        heartbeatJSON["timezone"] = await server.getTimezone();
        heartbeatJSON["timezoneOffset"] = server.getTimezoneOffset();
        heartbeatJSON["localDateTime"] = dayjs.utc(heartbeatJSON["time"]).tz(heartbeatJSON["timezone"]).format(SQL_DATETIME_FORMAT);

        try {
            await Notification.send(config, msg, await monitor.toJSON(false), heartbeatJSON);
            log.info("acknowledgement", `Told ${bean.email} that monitor #${monitor.id} is back up`);
        } catch (e) {
            log.error("acknowledgement", `Cannot reach ${bean.email}: ${e.message}`);
        }
    }
}

module.exports = Acknowledgement;
