<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Markdown } from 'tiptap-markdown'
import { watch, onBeforeUnmount } from 'vue'
import { SlashCommands, getSuggestionItems, renderItems } from './slashCommand'

const props = defineProps<{
  modelValue: string | undefined
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editor = useEditor({
  content: props.modelValue || '',
  extensions: [
    StarterKit,
    Markdown,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    SlashCommands.configure({
      suggestion: {
        items: getSuggestionItems,
        render: renderItems,
      },
    }),
    Placeholder.configure({
      placeholder: 'Type \'/\' for commands, \'# \' for H1, or just start writing...',
    })
  ],
  onUpdate: ({ editor }) => {
    emit('update:modelValue', editor.storage.markdown.getMarkdown())
  },
})

watch(() => props.modelValue, (value) => {
  // Prevent cursor jumping by checking if content is actually different
  const isSame = editor.value?.storage.markdown.getMarkdown() === value
  if (isSame) return

  if (editor.value) {
    editor.value.commands.setContent(value || '', false)
  }
})

onBeforeUnmount(() => {
  if (editor.value) {
    editor.value.destroy()
  }
})
</script>

<template>
  <div class="secure-note-editor">
    <editor-content :editor="editor" class="tiptap-wrapper" />
  </div>
</template>

<style>
.secure-note-editor {
  border: 1px solid #1e293b;
  border-radius: 0.5rem;
  background: #0f172a;
  margin-top: 1.5rem;
  transition: border-color 0.2s;
}

.secure-note-editor:focus-within {
  border-color: #3b82f6;
}

.tiptap-wrapper .tiptap {
  min-height: 250px;
  outline: none;
  padding: 1.5rem;
  font-size: 14px;
  line-height: 1.6;
  color: #e2e8f0;
}

.tiptap-wrapper .tiptap p.is-editor-empty:first-child::before {
  color: #475569;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

.tiptap-wrapper .tiptap h1 {
  font-size: 1.5rem;
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 1rem;
  color: #f8fafc;
}

.tiptap-wrapper .tiptap h1:first-child {
  margin-top: 0;
}

.tiptap-wrapper .tiptap h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  color: #f8fafc;
}

.tiptap-wrapper .tiptap h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  color: #f8fafc;
}

.tiptap-wrapper .tiptap ul,
.tiptap-wrapper .tiptap ol {
  padding-left: 1.5rem;
  margin-bottom: 1rem;
}

.tiptap-wrapper .tiptap li {
  margin-bottom: 0.25rem;
}

.tiptap-wrapper .tiptap li p {
  margin: 0;
}

.tiptap-wrapper .tiptap pre {
  background: #020617;
  border: 1px solid #1e293b;
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  color: #38bdf8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  margin-bottom: 1rem;
  overflow-x: auto;
}

.tiptap-wrapper .tiptap code {
  background: #1e293b;
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.9em;
}

.tiptap-wrapper .tiptap blockquote {
  border-left: 3px solid #3b82f6;
  padding-left: 1rem;
  color: #94a3b8;
  margin: 1rem 0;
}

.tiptap-wrapper .tiptap hr {
  border: none;
  border-top: 1px solid #1e293b;
  margin: 1.5rem 0;
}

/* Table styles */
.tiptap-wrapper .tiptap table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  margin: 1.5rem 0;
  overflow: hidden;
}

.tiptap-wrapper .tiptap table td,
.tiptap-wrapper .tiptap table th {
  min-width: 1em;
  border: 1px solid #334155;
  padding: 0.5rem 0.75rem;
  vertical-align: top;
  box-sizing: border-box;
  position: relative;
}

.tiptap-wrapper .tiptap table th {
  background-color: #0f172a;
  font-weight: bold;
  text-align: left;
}

.tiptap-wrapper .tiptap table .selectedCell:after {
  z-index: 2;
  position: absolute;
  content: "";
  left: 0; right: 0; top: 0; bottom: 0;
  background: rgba(59, 130, 246, 0.2);
  pointer-events: none;
}
</style>
