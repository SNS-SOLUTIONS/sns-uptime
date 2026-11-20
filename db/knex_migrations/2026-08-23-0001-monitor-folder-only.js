exports.up = function (knex) {
    return knex.schema
        .alterTable("monitor", function (table) {
            table.boolean("folder_only").notNullable().defaultTo(false);
        })
        .then(() => {
            // Groups created before this option existed were meant to organise
            // monitors, not to behave like a probe of their own.
            return knex("monitor").where("type", "group").update({ folder_only: true });
        });
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("folder_only");
    });
};
