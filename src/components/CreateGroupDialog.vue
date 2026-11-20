<template>
    <div ref="modal" class="modal fade" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        {{ $t("New Group") }}
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" />
                </div>
                <div class="modal-body">
                    <form @submit.prevent="confirm">
                        <div>
                            <label for="draftGroupName" class="form-label">{{ $t("Group Name") }}</label>
                            <input id="draftGroupName" v-model="groupName" type="text" class="form-control">
                        </div>

                        <!-- The new folder can be filed straight into an agency -->
                        <div v-if="agencyList.length > 0" class="mt-3">
                            <label for="draftGroupAgency" class="form-label">{{ $t("Agency") }}</label>
                            <select id="draftGroupAgency" v-model="agencyID" class="form-select">
                                <option :value="null">{{ $t("No agency") }}</option>
                                <option v-for="agency in agencyList" :key="agency.id" :value="agency.id">
                                    {{ agency.name }}
                                </option>
                            </select>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                        {{ $t("Cancel") }}
                    </button>
                    <button type="button" class="btn btn-primary" data-bs-dismiss="modal" :disabled="groupName == '' || groupName == null" @click="confirm">
                        {{ $t("Confirm") }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { Modal } from "bootstrap";

export default {
    props: {},
    emits: [ "added" ],
    data: () => ({
        modal: null,
        groupName: null,
        agencyID: null,
    }),
    computed: {
        /**
         * @returns {object[]} Agencies the new group can be filed into, by name
         */
        agencyList() {
            return Object.values(this.$root.monitorList)
                .filter(monitor => monitor.agency)
                .sort((m1, m2) => m1.name.localeCompare(m2.name));
        },
    },
    mounted() {
        this.modal = new Modal(this.$refs.modal);
    },
    methods: {
        /**
         * Show the confirm dialog
         * @param {?number} agencyID Agency suggested for the new group
         * @returns {void}
         */
        show(agencyID = null) {
            this.agencyID = agencyID;
            this.modal.show();
        },
        /**
         * Dialog confirmed
         * @returns {void}
         */
        confirm() {
            this.$emit("added", this.groupName, this.agencyID);
            this.modal.hide();
        },
    },
};
</script>
