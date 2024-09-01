const { BeanModel } = require("redbean-node/dist/bean-model");
const { R } = require("redbean-node");
const cheerio = require("cheerio");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const jsesc = require("jsesc");
const googleAnalytics = require("../google-analytics");
const { marked } = require("marked");

class StatusPage extends BeanModel {

    /**
     * Like this: { "test-uptime.kuma.pet": "default" }
     * @type {{}}
     */
    static domainMappingList = { };

    /**
     * Handle responses to status page
     * @param {Response} response Response object
     * @param {string} indexHTML HTML to render
     * @param {string} slug Status page slug
     * @returns {Promise<void>}
     */
    static async handleStatusPageResponse(response, indexHTML, slug) {
        // Handle url with trailing slash (http://localhost:3001/status/)
        // The slug comes from the route "/status/:slug". If the slug is empty, express converts it to "index.html"
        if (slug === "index.html") {
            slug = "default";
        }

        let statusPage = await R.findOne("status_page", " slug = ? ", [
            slug
        ]);

        if (statusPage) {
            response.send(await StatusPage.renderHTML(indexHTML, statusPage));
        } else {
            response.status(404).send(UptimeKumaServer.getInstance().indexHTML);
        }
    }

    /**
     * SSR for status pages
     * @param {string} indexHTML HTML page to render
     * @param {StatusPage} statusPage Status page populate HTML with
     * @returns {Promise<string>} the rendered html
     */
    static async renderHTML(indexHTML, statusPage) {
        const $ = cheerio.load(indexHTML);

        const description155 = marked(statusPage.description ?? "")
            .replace(/<[^>]+>/gm, "")
            .trim()
            .substring(0, 155);

        $("title").text(statusPage.title);
        $("meta[name=description]").attr("content", description155);

        if (statusPage.icon) {
            $("link[rel=icon]")
                .attr("href", statusPage.icon)
                .removeAttr("type");

            $("link[rel=apple-touch-icon]").remove();
        }

        const head = $("head");

        if (statusPage.googleAnalyticsTagId) {
            let escapedGoogleAnalyticsScript = googleAnalytics.getGoogleAnalyticsScript(statusPage.googleAnalyticsTagId);
            head.append($(escapedGoogleAnalyticsScript));
        }

        // OG Meta Tags
        let ogTitle = $("<meta property=\"og:title\" content=\"\" />").attr("content", statusPage.title);
        head.append(ogTitle);

        let ogDescription = $("<meta property=\"og:description\" content=\"\" />").attr("content", description155);
        head.append(ogDescription);

        // Preload data
        // Add jsesc, fix https://github.com/luucfr/sns-uptime/issues/2186
        const escapedJSONObject = jsesc(await StatusPage.getStatusPageData(statusPage), {
            "isScriptContext": true
        });

        const script = $(`
            <script id="preload-data" data-json="{}">
                window.preloadData = ${escapedJSONObject};
            </script>
        `);

        head.append(script);

        // manifest.json
        $("link[rel=manifest]").attr("href", `/api/status-page/${statusPage.slug}/manifest.json`);

        return $.root().html();
    }

    /**
     * Get all status page data in one call
     * @param {StatusPage} statusPage Status page to get data for
     * @returns {object} Status page data
     */
    static async getStatusPageData(statusPage) {
        const config = await statusPage.toPublicJSON();

        // Incident
        let incident = await R.findOne("incident", " pin = 1 AND active = 1 AND status_page_id = ? ", [
            statusPage.id,
        ]);

        if (incident) {
            incident = incident.toPublicJSON();
        }

        let maintenanceList = await StatusPage.getMaintenanceList(statusPage.id);

        // Public Group List
        const publicGroupList = [];
        const showTags = !!statusPage.show_tags;

        const list = await R.find("group", " public = 1 AND status_page_id = ? ORDER BY weight ", [
            statusPage.id
        ]);

        for (let groupBean of list) {
            let monitorGroup = await groupBean.toPublicJSON(showTags, config?.showCertificateExpiry);
            publicGroupList.push(monitorGroup);
        }

        // Response
        return {
            config,
            incident,
            publicGroupList,
            maintenanceList,
        };
    }

    /**
     * Loads domain mapping from DB
     * Return object like this: { "test-uptime.kuma.pet": "default" }
     * @returns {Promise<void>}
     */
    static async loadDomainMappingList() {
        StatusPage.domainMappingList = await R.getAssoc(`
            SELECT domain, slug
            FROM status_page, status_page_cname
            WHERE status_page.id = status_page_cname.status_page_id
        `);
    }

    /**
     * Send status page list to client
     * @param {Server} io io Socket server instance
     * @param {Socket} socket Socket.io instance
     * @returns {Promise<Bean[]>} Status page list
     */
    static async sendStatusPageList(io, socket) {
        let result = {};

        let list = await R.findAll("status_page", " ORDER BY title ");

        for (let item of list) {
            result[item.id] = await item.toJSON();
        }

        io.to(socket.userID).emit("statusPageList", result);
        return list;
    }

    /**
     * Update list of domain names
     * @param {string[]} domainNameList List of status page domains
     * @returns {Promise<void>}
     */
    async updateDomainNameList(domainNameList) {

        if (!Array.isArray(domainNameList)) {
            throw new Error("Invalid array");
        }

        let trx = await R.begin();

        await trx.exec("DELETE FROM status_page_cname WHERE status_page_id = ?", [
            this.id,
        ]);

        try {
            for (let domain of domainNameList) {
                if (typeof domain !== "string") {
                    throw new Error("Invalid domain");
                }

                if (domain.trim() === "") {
                    continue;
                }

                // If the domain name is used in another status page, delete it
                await trx.exec("DELETE FROM status_page_cname WHERE domain = ?", [
                    domain,
                ]);

                let mapping = trx.dispense("status_page_cname");
                mapping.status_page_id = this.id;
                mapping.domain = domain;
                await trx.store(mapping);
            }
            await trx.commit();
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    }

    /**
     * Get list of domain names
     * @returns {object[]} List of status page domains
     */
    getDomainNameList() {
        let domainList = [];
        for (let domain in StatusPage.domainMappingList) {
            let s = StatusPage.domainMappingList[domain];

            if (this.slug === s) {
                domainList.push(domain);
            }
        }
        return domainList;
    }

    /**
     * Return an object that ready to parse to JSON
     * @returns {object} Object ready to parse
     */
    async toJSON() {
        return {
            id: this.id,
            slug: this.slug,
            title: this.title,
            description: this.description,
            icon: this.getIcon(),
            theme: this.theme,
            autoRefreshInterval: this.autoRefreshInterval,
            published: !!this.published,
            showTags: !!this.show_tags,
            domainNameList: this.getDomainNameList(),
            customCSS: this.custom_css,
            footerText: this.footer_text,
            showPoweredBy: !!this.show_powered_by,
            googleAnalyticsId: this.google_analytics_tag_id,
            showCertificateExpiry: !!this.show_certificate_expiry,
        };
    }

    /**
     * Return an object that ready to parse to JSON for public
     * Only show necessary data to public
     * @returns {object} Object ready to parse
     */
    async toPublicJSON() {
        return {
            slug: this.slug,
            title: this.title,
            description: this.description,
            icon: this.getIcon(),
            autoRefreshInterval: this.autoRefreshInterval,
            theme: this.theme,
            published: !!this.published,
            showTags: !!this.show_tags,
            customCSS: this.custom_css,
            footerText: this.footer_text,
            showPoweredBy: !!this.show_powered_by,
            googleAnalyticsId: this.google_analytics_tag_id,
            showCertificateExpiry: !!this.show_certificate_expiry,
        };
    }

    /**
     * Convert slug to status page ID
     * @param {string} slug Status page slug
     * @returns {Promise<number>} ID of status page
     */
    static async slugToID(slug) {
        return await R.getCell("SELECT id FROM status_page WHERE slug = ? ", [
            slug
        ]);
    }

    /**
     * Get path to the icon for the page
     * @returns {string} Path
     */
    getIcon() {
        if (!this.icon) {
            return "/icon.png";
        } else {
            return this.icon;
        }
    }

    /**
     * Get list of maintenances
     * @param {number} statusPageId ID of status page to get maintenance for
     * @returns {object} Object representing maintenances sanitized for public
     */
    static async getMaintenanceList(statusPageId) {
        try {
            const publicMaintenanceList = [];

            let maintenanceIDList = await R.getCol(`
                SELECT DISTINCT maintenance_id
                FROM maintenance_status_page
                WHERE status_page_id = ?
            `, [ statusPageId ]);

            for (const maintenanceID of maintenanceIDList) {
                let maintenance = UptimeKumaServer.getInstance().getMaintenance(maintenanceID);
                if (maintenance && await maintenance.isUnderMaintenance()) {
                    publicMaintenanceList.push(await maintenance.toPublicJSON());
                }
            }

            return publicMaintenanceList;

        } catch (error) {
            return [];
        }
    }
}

module.exports = StatusPage;
