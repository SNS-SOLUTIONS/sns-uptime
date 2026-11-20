<template>
    <div>
        <div :style="depthMargin">
            <!-- Checkbox -->
            <div v-if="isSelectMode" class="select-input-wrapper">
                <input
                    class="form-check-input select-input"
                    type="checkbox"
                    :aria-label="$t('Check/Uncheck')"
                    :checked="isSelected(monitor.id)"
                    @click.stop="toggleSelection"
                />
            </div>

            <router-link :to="monitorURL(monitor.id)" class="item" :class="{ 'disabled': ! monitor.active }">
                <div class="row">
                    <div class="col-9 col-md-8 small-padding" :class="{ 'monitor-item': $root.userHeartbeatBar == 'bottom' || $root.userHeartbeatBar == 'none' }">
                        <div class="info" :class="{ 'is-agency': monitor.agency }">
                            <span
                                v-if="monitor.folderOnly"
                                class="folder-badge"
                                :class="'text-' + folderColor"
                                :title="monitor.agency ? $t('Agency') : $t('Folder')"
                            >
                                <font-awesome-icon :icon="monitor.agency ? 'building' : 'folder'" />
                            </span>
                            <Uptime v-else :monitor="monitor" type="24" :pill="true" />
                            <span v-if="hasChildren" class="collapse-padding" @click.prevent="changeCollapsed">
                                <font-awesome-icon icon="chevron-down" class="animated" :class="{ collapsed: isFolded }" />
                            </span>
                            {{ monitor.name }}
                        </div>
                        <div v-if="monitor.tags.length > 0" class="tags">
                            <Tag v-for="tag in monitor.tags" :key="tag" :item="tag" :size="'sm'" />
                        </div>
                    </div>
                    <div v-show="$root.userHeartbeatBar == 'normal'" :key="$root.userHeartbeatBar" class="col-3 col-md-4">
                        <HeartbeatBar v-if="! monitor.folderOnly" ref="heartbeatBar" size="small" :monitor-id="monitor.id" />
                    </div>
                </div>

                <div v-if="$root.userHeartbeatBar == 'bottom' && ! monitor.folderOnly" class="row">
                    <div class="col-12 bottom-style">
                        <HeartbeatBar ref="heartbeatBar" size="small" :monitor-id="monitor.id" />
                    </div>
                </div>
            </router-link>
        </div>

        <transition name="slide-fade-up">
            <div v-if="!isFolded" class="childs">
                <MonitorListItem
                    v-for="item in sortedChildMonitorList"
                    :key="item.id"
                    :monitor="item"
                    :isSelectMode="isSelectMode"
                    :isSelected="isSelected"
                    :select="select"
                    :deselect="deselect"
                    :filter-func="filterFunc"
                    :sort-func="sortFunc"
                    :filtering="filtering"
                    :depth="depth + 1"
                />
            </div>
        </transition>
    </div>
</template>

<script>
import HeartbeatBar from "../components/HeartbeatBar.vue";
import Tag from "../components/Tag.vue";
import Uptime from "../components/Uptime.vue";
import { DOWN, MAINTENANCE, PENDING, UP, getMonitorRelativeURL } from "../util.ts";

export default {
    name: "MonitorListItem",
    components: {
        Uptime,
        HeartbeatBar,
        Tag,
    },
    props: {
        /** Monitor this represents */
        monitor: {
            type: Object,
            default: null,
        },
        /** If the user is in select mode */
        isSelectMode: {
            type: Boolean,
            default: false,
        },
        /** How many ancestors are above this monitor */
        depth: {
            type: Number,
            default: 0,
        },
        /** Callback to determine if monitor is selected */
        isSelected: {
            type: Function,
            default: () => {}
        },
        /** Callback fired when monitor is selected */
        select: {
            type: Function,
            default: () => {}
        },
        /** Callback fired when monitor is deselected */
        deselect: {
            type: Function,
            default: () => {}
        },
        /** Function to filter child monitors */
        filterFunc: {
            type: Function,
            default: () => {}
        },
        /** Function to sort child monitors */
        sortFunc: {
            type: Function,
            default: () => {},
        },
        /**
         * Is the list being searched or filtered? What matches is then shown
         * straight away, without having to unfold agency and folder by hand.
         */
        filtering: {
            type: Boolean,
            default: false,
        },
    },
    data() {
        return {
            isCollapsed: true,
            // Folding done during a search is only meant for that search, it
            // does not touch what is remembered for the regular list
            isCollapsedWhileFiltering: false,
        };
    },
    computed: {
        sortedChildMonitorList() {
            const children = this.$root.monitorChildrenList[this.monitor.id] ?? [];

            // Run filter on children
            let result = children.filter(this.filterFunc);

            result.sort(this.sortFunc);

            return result;
        },
        hasChildren() {
            return this.sortedChildMonitorList.length > 0;
        },
        /**
         * @returns {boolean} Are the children hidden right now?
         */
        isFolded() {
            return this.filtering ? this.isCollapsedWhileFiltering : this.isCollapsed;
        },
        depthMargin() {
            return {
                marginLeft: `${31 * this.depth}px`,
            };
        },
        /**
         * A folder shows no uptime, but its icon still carries the aggregated
         * status of what it contains.
         * @returns {string} Bootstrap colour name for the folder icon
         */
        folderColor() {
            const status = this.$root.getLastHeartbeat(this.monitor.id)?.status;

            if (status === MAINTENANCE) {
                return "maintenance";
            }
            if (status === DOWN) {
                return "danger";
            }
            if (status === UP) {
                return "primary";
            }
            if (status === PENDING) {
                return "warning";
            }

            return "secondary";
        },
    },
    watch: {
        isSelectMode() {
            // TODO: Resize the heartbeat bar, but too slow
            // this.$refs.heartbeatBar.resize();
        },
        filtering() {
            // Every search starts with everything that matches unfolded
            this.isCollapsedWhileFiltering = false;
        },
    },
    mounted() {
        this.$root.emitter.on("monitorCollapsedAll", this.applyCollapsedAll);
    },
    beforeUnmount() {
        this.$root.emitter.off("monitorCollapsedAll", this.applyCollapsedAll);
    },
    beforeMount() {

        // Always unfold if monitor is accessed directly
        if (this.monitor.childrenIDs.includes(parseInt(this.$route.params.id))) {
            this.isCollapsed = false;
            return;
        }

        // Set collapsed value based on local storage
        let storage = window.localStorage.getItem("monitorCollapsed");
        if (storage === null) {
            return;
        }

        let storageObject = JSON.parse(storage);
        if (storageObject[`monitor_${this.monitor.id}`] == null) {
            return;
        }

        this.isCollapsed = storageObject[`monitor_${this.monitor.id}`];
    },
    methods: {
        /**
         * Changes the collapsed value of the current monitor and saves
         * it to local storage
         * @returns {void}
         */
        changeCollapsed() {
            if (this.filtering) {
                this.isCollapsedWhileFiltering = !this.isCollapsedWhileFiltering;
                return;
            }

            this.isCollapsed = !this.isCollapsed;

            // Save collapsed value into local storage
            let storage = window.localStorage.getItem("monitorCollapsed");
            let storageObject = {};
            if (storage !== null) {
                storageObject = JSON.parse(storage);
            }
            storageObject[`monitor_${this.monitor.id}`] = this.isCollapsed;

            window.localStorage.setItem("monitorCollapsed", JSON.stringify(storageObject));

            // Let the list know, so its expand / collapse all button stays accurate
            this.$root.emitter.emit("monitorCollapsedChanged", {
                id: this.monitor.id,
                collapsed: this.isCollapsed,
            });
        },

        /**
         * Follow the expand / collapse all button. Storage is written once by
         * the list itself, there is nothing to persist here.
         * @param {boolean} collapsed Should this folder be closed?
         * @returns {void}
         */
        applyCollapsedAll(collapsed) {
            if (this.hasChildren) {
                this.isCollapsed = collapsed;
            }
        },
        /**
         * Get URL of monitor
         * @param {number} id ID of monitor
         * @returns {string} Relative URL of monitor
         */
        monitorURL(id) {
            return getMonitorRelativeURL(id);
        },
        /**
         * Toggle selection of monitor
         * @returns {void}
         */
        toggleSelection() {
            if (this.isSelected(this.monitor.id)) {
                this.deselect(this.monitor.id);
            } else {
                this.select(this.monitor.id);
            }
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.folder-badge {
    display: inline-block;
    min-width: 62px;
    text-align: center;
    font-size: 15px;
}

// The agency heads its own tree, it stands out from the folders below it.
// Set on the whole line: the name has to stay a plain text node, the space
// in front of it is what keeps it apart from the uptime pill or the chevron.
.is-agency {
    font-weight: bold;
}

.small-padding {
    padding-left: 5px !important;
    padding-right: 5px !important;
}

.collapse-padding {
    padding-left: 8px !important;
    padding-right: 2px !important;
}

// .monitor-item {
//     width: 100%;
// }

.tags {
    margin-top: 4px;
    padding-left: 67px;
    display: flex;
    flex-wrap: wrap;
    gap: 0;
}

.collapsed {
    transform: rotate(-90deg);
}

.animated {
    transition: all 0.2s $easing-in;
}

.select-input-wrapper {
    float: left;
    margin-top: 15px;
    margin-left: 3px;
    margin-right: 10px;
    padding-left: 4px;
    position: relative;
    z-index: 15;
}

</style>
