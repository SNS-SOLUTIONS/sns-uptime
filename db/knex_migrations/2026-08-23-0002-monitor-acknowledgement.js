exports.up = function (knex) {
    return knex.schema.createTable("monitor_acknowledgement", function (table) {
        table.increments("id");
        table.integer("monitor_id").unsigned().notNullable()
            .references("id").inTable("monitor")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        // Identity of the person who took the incident, as known at that moment.
        // It is copied rather than referenced: forward auth users can share a
        // single local account, and the acknowledgement belongs to the person.
        table.string("username", 255);
        table.string("display_name", 255);
        table.string("email", 255);
        table.datetime("created_date").notNullable().defaultTo(knex.fn.now());
        table.datetime("cleared_date").defaultTo(null);
        table.index([ "monitor_id", "cleared_date" ], "monitor_acknowledgement_active");
    });
};

exports.down = function (knex) {
    return knex.schema.dropTable("monitor_acknowledgement");
};
