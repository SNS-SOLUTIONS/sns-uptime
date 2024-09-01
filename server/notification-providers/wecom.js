const NotificationProvider = require("./notification-provider");
const axios = require("axios");
const { DOWN, UP } = require("../../src/util");

class WeCom extends NotificationProvider {
    name = "WeCom";

    /**
     * @inheritdoc
     */
    async send(notification, msg, monitorJSON = null, heartbeatJSON = null) {
        const okMsg = "Sent Successfully.";

        try {
            let config = {
                headers: {
                    "Content-Type": "application/json"
                }
            };
            let body = this.composeMessage(heartbeatJSON, msg);
            await axios.post(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${notification.weComBotKey}`, body, config);
            return okMsg;
        } catch (error) {
            this.throwGeneralAxiosError(error);
        }
    }

    /**
     * Generate the message to send
     * @param {object} heartbeatJSON Heartbeat details (For Up/Down only)
     * @param {string} msg General message
     * @returns {object} Message
     */
    composeMessage(heartbeatJSON, msg) {
        let title;
        if (msg != null && heartbeatJSON != null && heartbeatJSON["status"] === UP) {
            title = "UptimeKuma Monitor Up";
        }
        if (msg != null && heartbeatJSON != null && heartbeatJSON["status"] === DOWN) {
            title = "UptimeKuma Monitor Down";
        }
        if (msg != null) {
            title = "UptimeKuma Message";
        }
        return {
            msgtype: "text",
            text: {
                content: title + msg
            }
        };
    }
}

module.exports = WeCom;
