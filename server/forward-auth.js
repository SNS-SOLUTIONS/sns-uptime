const net = require("net");
const { R } = require("redbean-node");
const { log, genSecret } = require("../src/util");
const passwordHash = require("./password-hash");
const { args } = require("./config");

/**
 * Networks that are trusted to set the forward auth headers when nothing is
 * configured. This covers the usual "reverse proxy in the same Docker network"
 * setup, without trusting the whole internet.
 * @type {string}
 */
const DEFAULT_TRUSTED_PROXIES = "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7";

/**
 * Read a value from the CLI arguments, then from the environment
 * @param {string} argName Name of the CLI argument
 * @param {string} envName Name of the environment variable
 * @returns {(string|undefined)} Raw value, if any
 */
function readOption(argName, envName) {
    const value = args[argName] ?? process.env[envName];

    if (value === undefined || value === null) {
        return undefined;
    }

    return String(value);
}

/**
 * Interpret a raw option value as a boolean
 * @param {(string|undefined)} value Raw value
 * @param {boolean} defaultValue Value used when the option is not set
 * @returns {boolean} Parsed boolean
 */
function readBool(value, defaultValue) {
    if (value === undefined || value.trim() === "") {
        return defaultValue;
    }

    return [ "1", "true", "yes", "on" ].includes(value.trim().toLowerCase());
}

/**
 * Normalize an IP address so that it can be matched against a net.BlockList
 * IPv4-mapped IPv6 addresses (::ffff:10.0.0.1) are unwrapped to their IPv4 form
 * @param {(string|undefined)} ip IP address to normalize
 * @returns {(object|null)} Object with the address and its family, or null if invalid
 */
function normalizeIP(ip) {
    if (typeof ip !== "string" || ip === "") {
        return null;
    }

    let address = ip.trim().replace(/^\[|\]$/g, "").split("%")[0];

    if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(address)) {
        address = address.substring(7);
    }

    const family = net.isIP(address);

    if (family === 0) {
        return null;
    }

    return {
        address,
        type: family === 6 ? "ipv6" : "ipv4",
    };
}

/**
 * Build the list of networks allowed to set the forward auth headers
 * @param {string} spec Comma separated list of IPs and CIDRs, or "*" for any
 * @returns {(net.BlockList|null)} Block list, or null when every source is trusted
 */
function buildTrustedProxyList(spec) {
    if (spec.trim() === "*") {
        log.warn("forward-auth", "Every source is trusted to set the forward auth headers. Only do this if Uptime Kuma cannot be reached without going through your reverse proxy.");
        return null;
    }

    const blockList = new net.BlockList();

    for (const rawEntry of spec.split(",")) {
        const entry = rawEntry.trim();

        if (entry === "") {
            continue;
        }

        const separator = entry.lastIndexOf("/");
        const ip = normalizeIP(separator === -1 ? entry : entry.substring(0, separator));

        if (!ip) {
            log.warn("forward-auth", `Ignoring invalid trusted proxy entry: ${entry}`);
            continue;
        }

        try {
            if (separator === -1) {
                blockList.addAddress(ip.address, ip.type);
            } else {
                blockList.addSubnet(ip.address, Number(entry.substring(separator + 1)), ip.type);
            }
        } catch (e) {
            log.warn("forward-auth", `Ignoring invalid trusted proxy entry: ${entry} (${e.message})`);
        }
    }

    return blockList;
}

/**
 * Read a single header value, HTTP allows a header to be repeated
 * @param {IncomingHttpHeaders} headers Headers of the request
 * @param {string} name Lowercase name of the header
 * @returns {string} Trimmed value, empty when the header is absent
 */
function readHeader(headers, name) {
    const value = headers[name];

    if (Array.isArray(value)) {
        return (value[0] ?? "").trim();
    }

    if (typeof value !== "string") {
        return "";
    }

    return value.trim();
}

/**
 * Reject values that cannot come from a sane identity provider, mostly to keep
 * control characters out of the database and out of the logs
 * @param {string} value Value to check
 * @param {number} maxLength Maximum accepted length
 * @returns {boolean} Is the value usable?
 */
function isSaneValue(value, maxLength = 255) {
    // eslint-disable-next-line no-control-regex
    return value.length > 0 && value.length <= maxLength && !/[\x00-\x1f\x7f]/.test(value);
}

class ForwardAuth {

    /**
     * Read the configuration from the CLI arguments and the environment
     */
    constructor() {
        this.enabled = readBool(readOption("forward-auth", "UPTIME_KUMA_FORWARD_AUTH_ENABLED"), false);
        this.autoCreate = readBool(readOption("forward-auth-auto-create", "UPTIME_KUMA_FORWARD_AUTH_AUTO_CREATE"), true);

        // Uptime Kuma owns monitors per account, so giving every person their own
        // account gives everybody an empty dashboard. "shared" maps all of them to
        // the primary account, which is what a team dashboard is expected to do,
        // while still showing each person their own identity.
        this.mode = (readOption("forward-auth-mode", "UPTIME_KUMA_FORWARD_AUTH_MODE") || "shared").trim().toLowerCase();

        if (![ "shared", "per-user" ].includes(this.mode)) {
            log.warn("forward-auth", `Unknown mode "${this.mode}", falling back to "shared"`);
            this.mode = "shared";
        }

        this.userHeader = (readOption("forward-auth-user-header", "UPTIME_KUMA_FORWARD_AUTH_USER_HEADER") || "X-authentik-username").toLowerCase();
        this.emailHeader = (readOption("forward-auth-email-header", "UPTIME_KUMA_FORWARD_AUTH_EMAIL_HEADER") || "X-authentik-email").toLowerCase();
        this.nameHeader = (readOption("forward-auth-name-header", "UPTIME_KUMA_FORWARD_AUTH_NAME_HEADER") || "X-authentik-name").toLowerCase();
        this.groupsHeader = (readOption("forward-auth-groups-header", "UPTIME_KUMA_FORWARD_AUTH_GROUPS_HEADER") || "X-authentik-groups").toLowerCase();

        this.allowedGroups = (readOption("forward-auth-allowed-groups", "UPTIME_KUMA_FORWARD_AUTH_ALLOWED_GROUPS") || "")
            .split(",")
            .map(group => group.trim())
            .filter(group => group !== "");

        this.logoutURL = readOption("forward-auth-logout-url", "UPTIME_KUMA_FORWARD_AUTH_LOGOUT_URL") ?? "/outpost.goauthentik.io/sign_out";

        this.trustedProxyList = null;
        this.trustedProxySpec = readOption("forward-auth-trusted-proxies", "UPTIME_KUMA_FORWARD_AUTH_TRUSTED_PROXIES") || DEFAULT_TRUSTED_PROXIES;

        if (this.enabled) {
            this.trustedProxyList = buildTrustedProxyList(this.trustedProxySpec);
            log.info("forward-auth", `Forward auth is enabled in "${this.mode}" mode, reading the identity from the "${this.userHeader}" header`);
        }
    }

    /**
     * Is the request coming from a reverse proxy we trust to set the headers?
     * @param {(string|undefined)} remoteAddress Address of the direct peer
     * @returns {boolean} Can the headers of this request be trusted?
     */
    isTrustedProxy(remoteAddress) {
        if (this.trustedProxyList === null) {
            return true;
        }

        const ip = normalizeIP(remoteAddress);

        if (!ip) {
            return false;
        }

        return this.trustedProxyList.check(ip.address, ip.type);
    }

    /**
     * Read the identity injected by the identity provider
     * @param {IncomingHttpHeaders} headers Headers of the request
     * @returns {(object|null)} Identity, or null when the headers are absent or unusable
     */
    extractIdentity(headers) {
        const username = readHeader(headers, this.userHeader);

        if (!isSaneValue(username)) {
            if (username !== "") {
                log.warn("forward-auth", "Ignoring a forward auth header with an unusable username");
            }
            return null;
        }

        const email = readHeader(headers, this.emailHeader);
        const displayName = readHeader(headers, this.nameHeader);

        return {
            username,
            email: isSaneValue(email) ? email : null,
            displayName: isSaneValue(displayName) ? displayName : username,
            groups: readHeader(headers, this.groupsHeader)
                .split(/[|,]/)
                .map(group => group.trim())
                .filter(group => group !== ""),
        };
    }

    /**
     * Is this identity allowed in, according to the group restriction?
     * @param {object} identity Identity read from the headers
     * @returns {boolean} Is the user allowed?
     */
    isAllowed(identity) {
        if (this.allowedGroups.length === 0) {
            return true;
        }

        return identity.groups.some(group => this.allowedGroups.includes(group));
    }

    /**
     * Get the account every forward auth user shares, creating it on a brand
     * new instance so that the setup wizard can be skipped
     * @param {object} identity Identity read from the headers
     * @returns {Promise<Bean>} Primary user of this instance
     */
    async getSharedUser(identity) {
        const user = await R.findOne("user", " active = 1 ORDER BY id ");

        if (user) {
            return user;
        }

        log.info("forward-auth", `No account exists yet, creating the primary account "${identity.username}"`);

        return this.createUser(identity);
    }

    /**
     * Create a local account for an identity
     * @param {object} identity Identity read from the headers
     * @returns {Promise<Bean>} Created user
     */
    async createUser(identity) {
        const user = R.dispense("user");
        user.username = identity.username;
        // The password is never used, forward auth users log in through the
        // identity provider. It is random so that it cannot be guessed.
        user.password = passwordHash.generate(genSecret(32));
        user.active = true;
        user.email = identity.email;
        user.display_name = identity.displayName;

        await R.store(user);

        return user;
    }

    /**
     * Find the local account of an identity, creating it when auto provisioning
     * is on, and keep its profile in sync with the provider
     * @param {object} identity Identity read from the headers
     * @returns {Promise<(Bean|null)>} Matching user, or null if there is none
     */
    async getPerUser(identity) {
        const user = await R.findOne("user", " username = ? ", [ identity.username ]);

        if (!user) {
            if (!this.autoCreate) {
                return null;
            }

            log.info("forward-auth", `Creating user "${identity.username}"`);

            return this.createUser(identity);
        }

        if (!user.active) {
            return user;
        }

        // Keep the profile in sync, the identity provider owns it
        if (user.email !== identity.email || user.display_name !== identity.displayName) {
            user.email = identity.email;
            user.display_name = identity.displayName;
            await R.store(user);
        }

        return user;
    }

    /**
     * Authenticate a socket.io connection using the headers set by the
     * identity provider in front of Uptime Kuma
     * @param {Socket} socket Socket.io socket instance
     * @returns {Promise<(object|null)>} Result of {@link ForwardAuth#authenticateHeaders}
     */
    async authenticate(socket) {
        // handshake holds the headers of the request that opened the connection,
        // they cannot be changed afterwards by an upgrade or a new poll
        return this.authenticateHeaders(socket.handshake.headers, socket.handshake.address);
    }

    /**
     * Authenticate an incoming request using the headers set by the identity
     * provider in front of Uptime Kuma
     * @param {IncomingHttpHeaders} headers Headers of the request
     * @param {(string|undefined)} remoteAddress Address of the direct peer
     * @returns {Promise<(object|null)>} null when forward auth does not apply to this
     * request, otherwise `{ ok: true, user }` or `{ ok: false, msg, msgi18n }`
     */
    async authenticateHeaders(headers, remoteAddress) {
        if (!this.enabled) {
            return null;
        }

        if (readHeader(headers, this.userHeader) === "") {
            // No identity header: the request did not go through the identity
            // provider, fall back to the regular login form.
            return null;
        }

        if (!this.isTrustedProxy(remoteAddress)) {
            log.warn("forward-auth", `Rejected forward auth headers coming from an untrusted source. IP=${remoteAddress}`);
            return {
                ok: false,
                msg: "forwardAuthUntrustedProxy",
                msgi18n: true,
            };
        }

        const identity = this.extractIdentity(headers);

        if (!identity) {
            return {
                ok: false,
                msg: "forwardAuthInvalidHeaders",
                msgi18n: true,
            };
        }

        if (!this.isAllowed(identity)) {
            log.warn("forward-auth", `User "${identity.username}" is not a member of any allowed group`);
            return {
                ok: false,
                msg: "forwardAuthNotAllowed",
                msgi18n: true,
            };
        }

        const user = this.mode === "shared" ? await this.getSharedUser(identity) : await this.getPerUser(identity);

        if (!user) {
            log.warn("forward-auth", `User "${identity.username}" does not exist and auto provisioning is disabled`);
            return {
                ok: false,
                msg: "forwardAuthUnknownUser",
                msgi18n: true,
            };
        }

        if (!user.active) {
            log.warn("forward-auth", `User "${identity.username}" is inactive`);
            return {
                ok: false,
                msg: "authUserInactiveOrDeleted",
                msgi18n: true,
            };
        }

        return {
            ok: true,
            user,
            // Always show the person behind the request, even when several of
            // them share the same local account
            profile: {
                id: user.id,
                username: identity.username,
                displayName: identity.displayName,
                email: identity.email,
            },
        };
    }

    /**
     * Describe the forward auth session for the client
     * @param {object} profile Profile of the logged in person
     * @returns {object} Payload sent to the browser
     */
    toClientPayload(profile) {
        return {
            ...profile,
            logoutURL: this.logoutURL || null,
        };
    }
}

const forwardAuth = new ForwardAuth();

module.exports = {
    forwardAuth,
    ForwardAuth,
};
