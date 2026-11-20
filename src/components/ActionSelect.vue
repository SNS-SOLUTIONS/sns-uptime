<template>
    <div class="input-group mb-3">
        <select :id="id" ref="select" v-model="model" class="form-select" :disabled="disabled" :required="required">
            <template v-for="(option, index) in options" :key="index">
                <optgroup v-if="option.options" :label="option.label">
                    <option v-for="child in option.options" :key="child.value" :value="child.value" :disabled="child.disabled">{{ child.label }}</option>
                </optgroup>
                <option v-else :value="option.value" :disabled="option.disabled">{{ option.label }}</option>
            </template>
        </select>
        <button type="button" class="btn btn-outline-primary" :class="{ disabled: actionDisabled }" :aria-label="actionAriaLabel" @click="action()">
            <font-awesome-icon :icon="icon" aria-hidden="true" />
        </button>
    </div>
</template>

<script>
/**
 * Generic select field with a customizable action on the right.
 * Action is passed in as a function.
 */
export default {
    props: {
        /**
         * The choices: { label, value, disabled }. An entry holding its own
         * `options` list instead of a value is shown as a group of choices.
         */
        options: {
            type: Array,
            default: () => [],
        },
        /**
         * The id of the form which will be targeted by a <label for=..
         */
        id: {
            type: String,
            required: true,
        },
        /**
         * The value of the select field.
         */
        modelValue: {
            type: Number,
            default: null,
        },
        /**
         * Whether the select field is enabled / disabled.
         */
        disabled: {
            type: Boolean,
            default: false
        },
        /**
         * The icon displayed in the right button of the select field.
         * Accepts a Font Awesome icon string identifier.
         * @example "plus"
         */
        icon: {
            type: String,
            required: true,
        },
        /**
         * The action to be performed when the button is clicked.
         * Action is passed in as a function.
         */
        action: {
            type: Function,
            default: () => {},
        },
        /**
         * The aria-label of the action button
         */
        actionAriaLabel: {
            type: String,
            required: true,
        },
        /**
         * Whether the action button is disabled.
         * @example true
         */
        actionDisabled: {
            type: Boolean,
            default: false
        },
        /**
         * Whether the select field is required.
         * @example true
         */
        required: {
            type: Boolean,
            default: false,
        }
    },
    emits: [ "update:modelValue" ],
    computed: {
        /**
         * Send value update to parent on change.
         */
        model: {
            get() {
                return this.modelValue;
            },
            set(value) {
                this.$emit("update:modelValue", value);
            }
        }
    },
};
</script>
