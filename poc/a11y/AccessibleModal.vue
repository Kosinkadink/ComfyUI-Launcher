<!--
  PoC: Accessible modal dialog component for ComfyUI Launcher.

  Demonstrates the WAI-ARIA Dialog (Modal) pattern applied to the current
  modal system (renderer/modal.js, 119 lines). This component implements:

  1. role="dialog" + aria-modal="true"
  2. aria-labelledby pointing to the title element
  3. aria-describedby pointing to the message element
  4. Focus trapping (Tab/Shift+Tab cycle within modal)
  5. Escape key closes the dialog
  6. Focus restoration to the element that opened the dialog
  7. Background scroll prevention

  This is a standalone PoC — it does not modify renderer/modal.js.
  In a full migration, this pattern would replace the three modal methods
  (alert, confirm, prompt) in modal.js.
-->
<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="modal-overlay"
      @mousedown.self="onOverlayMousedown"
      @click.self="onOverlayClick"
    >
      <div
        ref="dialogRef"
        class="modal-box"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="messageId"
        @keydown="onKeydown"
      >
        <div :id="titleId" class="modal-title">
          {{ title }}
        </div>
        <div :id="messageId" class="modal-message">
          {{ message }}
        </div>

        <!-- Prompt input (shown only for prompt variant) -->
        <div v-if="variant === 'prompt'" class="modal-input-wrap">
          <input
            ref="inputRef"
            v-model="inputValue"
            type="text"
            class="modal-input"
            :placeholder="placeholder"
            :aria-describedby="errorId"
            :aria-invalid="!!errorText"
            @input="errorText = ''"
            @keydown.enter="onSubmit"
          >
          <div
            :id="errorId"
            class="modal-error"
            role="alert"
            aria-live="assertive"
          >
            {{ errorText }}
          </div>
        </div>

        <div class="modal-actions">
          <button
            v-if="variant !== 'alert'"
            ref="cancelRef"
            class="modal-cancel"
            @click="onCancel"
          >
            {{ cancelLabel }}
          </button>
          <button
            ref="confirmRef"
            :class="[variant === 'confirm' ? confirmStyle : 'primary', 'modal-confirm']"
            @click="onSubmit"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, nextTick, watch, onBeforeUnmount } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  variant: { type: String, default: 'alert', validator: (v) => ['alert', 'confirm', 'prompt'].includes(v) },
  title: { type: String, required: true },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: 'OK' },
  cancelLabel: { type: String, default: 'Cancel' },
  confirmStyle: { type: String, default: 'danger' },
  placeholder: { type: String, default: '' },
  required: { type: Boolean, default: false },
  requiredMessage: { type: String, default: 'This field is required.' },
});

const emit = defineEmits(['confirm', 'cancel', 'close']);

// Unique IDs for ARIA references
const uid = Math.random().toString(36).slice(2, 8);
const titleId = `modal-title-${uid}`;
const messageId = `modal-message-${uid}`;
const errorId = `modal-error-${uid}`;

// Refs
const dialogRef = ref(null);
const inputRef = ref(null);
const cancelRef = ref(null);
const confirmRef = ref(null);
const inputValue = ref('');
const errorText = ref('');

// Track the element that opened the modal for focus restoration
let previouslyFocusedElement = null;

watch(() => props.visible, async (isVisible) => {
  if (isVisible) {
    previouslyFocusedElement = document.activeElement;
    document.body.style.overflow = 'hidden';

    await nextTick();

    // Focus the most appropriate element per WAI-ARIA guidelines:
    // - prompt: focus the input
    // - confirm: focus the cancel (least destructive) button
    // - alert: focus the OK button
    if (props.variant === 'prompt' && inputRef.value) {
      inputRef.value.focus();
    } else if (props.variant === 'confirm' && cancelRef.value) {
      cancelRef.value.focus();
    } else if (confirmRef.value) {
      confirmRef.value.focus();
    }
  } else {
    document.body.style.overflow = '';

    // Restore focus to the element that triggered the modal
    if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
      previouslyFocusedElement.focus();
      previouslyFocusedElement = null;
    }
  }
});

onBeforeUnmount(() => {
  document.body.style.overflow = '';
});

/**
 * Focus trapping: cycle Tab/Shift+Tab within the dialog.
 * Close on Escape.
 */
function onKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    onCancel();
    return;
  }

  if (e.key === 'Tab') {
    const dialog = dialogRef.value;
    if (!dialog) return;

    const focusable = dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}

function onSubmit() {
  if (props.variant === 'prompt') {
    const val = inputValue.value.trim();
    if (!val && props.required) {
      errorText.value = props.requiredMessage;
      if (inputRef.value) inputRef.value.focus();
      return;
    }
    emit('confirm', val || null);
  } else {
    emit('confirm', true);
  }
  emit('close');
}

function onCancel() {
  emit('cancel');
  emit('close');
}

// Overlay click-to-close: only if mousedown started on overlay
let downOnOverlay = false;
function onOverlayMousedown() {
  downOnOverlay = true;
}
function onOverlayClick() {
  if (downOnOverlay) {
    onCancel();
  }
  downOnOverlay = false;
}
</script>
