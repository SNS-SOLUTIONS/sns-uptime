const { R } = require("redbean-node");
const { log } = require("../../src/util");
const { setSetting, setting } = require("../util-server");
const Database = require("../database");

const DEFAULT_KEEP_PERIOD = 180;

/**
 * Heartbeats deleted per statement. Small enough for a statement to last a
 * few tens of milliseconds, so the monitors are never kept waiting long.
 */
const DELETE_SLICE_SIZE = 10000;

/**
 * Clears old data from the heartbeat table of the database.
 * @returns {Promise<void>} A promise that resolves when the data has been cleared.
 */

const clearOldData = async () => {
    let period = await setting("keepDataPeriodDays");

    // Set Default Period
    if (period == null) {
        await setSetting("keepDataPeriodDays", DEFAULT_KEEP_PERIOD, "general");
        period = DEFAULT_KEEP_PERIOD;
    }

    // Try parse setting
    let parsedPeriod;
    try {
        parsedPeriod = parseInt(period);
    } catch (_) {
        log.warn("clearOldData", "Failed to parse setting, resetting to default..");
        await setSetting("keepDataPeriodDays", DEFAULT_KEEP_PERIOD, "general");
        parsedPeriod = DEFAULT_KEEP_PERIOD;
    }

    if (parsedPeriod < 1) {
        log.info("clearOldData", `Data deletion has been disabled as period is less than 1. Period is ${parsedPeriod} days.`);
    } else {

        log.debug("clearOldData", `Clearing Data older than ${parsedPeriod} days...`);

        try {
            await deleteOldHeartbeats(parsedPeriod * -24);

            if (Database.dbConfig.type === "sqlite") {
                // Without a limit, the statistics are rebuilt by reading the
                // whole table, which holds the database for seconds (7 s with
                // a month of history for 500 monitors). A sample is enough, as
                // SQLite recommends.
                await R.exec("PRAGMA analysis_limit = 400;");
                await R.exec("PRAGMA optimize;");
            }
        } catch (e) {
            log.error("clearOldData", `Failed to clear old data: ${e.message}`);
        }
    }
};

/**
 * Delete the heartbeats older than the retention period, one slice of rows at
 * a time. A single DELETE holds the database for as long as it runs, which
 * becomes minutes with a large history, and with SQLite no monitor can store
 * anything meanwhile. The slices follow the row IDs, the order the rows were
 * written in: each statement only goes through neighbouring pages.
 * @param {number} hourOffset Hours from now (negative) before which heartbeats are deleted
 * @returns {Promise<void>}
 */
async function deleteOldHeartbeats(hourOffset) {
    const sqlHourOffset = Database.sqlHourOffset();

    // The newest heartbeat to delete, looked up monitor by monitor along the
    // (monitor_id, time) index rather than by going through the whole table.
    // getCell() adds the LIMIT 1 itself, in the syntax of the database.
    let lastID = 0;
    for (const monitorID of await R.getCol("SELECT id FROM monitor")) {
        const id = await R.getCell(
            `SELECT id FROM heartbeat WHERE monitor_id = ? AND time < ${sqlHourOffset} ORDER BY time DESC`,
            [ monitorID, hourOffset ]
        );

        if (id > lastID) {
            lastID = id;
        }
    }

    // Each slice checks the time again: whatever is recent stays
    let firstID = await R.getCell("SELECT MIN(id) FROM heartbeat");
    while (firstID !== null && firstID !== undefined && firstID <= lastID) {
        await R.exec(
            `DELETE FROM heartbeat WHERE id >= ? AND id < ? AND time < ${sqlHourOffset}`,
            [ firstID, firstID + DELETE_SLICE_SIZE, hourOffset ]
        );
        firstID += DELETE_SLICE_SIZE;
    }
}

module.exports = {
    clearOldData,
};
