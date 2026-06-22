import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import tippy from 'tippy.js'
import SlashMenu from './SlashMenu.vue'
import type { Editor, Range } from '@tiptap/core'
import type { Instance as TippyInstance } from 'tippy.js'

export type SuggestionItem = {
  title: string
  command: (params: { editor: Editor; range: Range }) => void
}

export const getSuggestionItems = ({ query }: { query: string }): SuggestionItem[] => {
  return [
    {
      title: 'Heading 1',
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
      },
    },
    {
      title: 'Heading 2',
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
      },
    },
    {
      title: 'Heading 3',
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
      },
    },
    {
      title: 'Table',
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      },
    },
    {
      title: 'Bullet List',
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
      },
    },
    {
      title: 'Numbered List',
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
      },
    },
    {
      title: 'Blockquote',
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run()
      },
    },
    {
      title: 'Code Block',
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
      },
    },
    {
      title: 'Divider',
      command: ({ editor, range }: { editor: Editor; range: Range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run()
      },
    },
  ].filter(item => item.title.toLowerCase().startsWith(query.toLowerCase())).slice(0, 10)
}

export const renderItems = () => {
  let component: VueRenderer
  let popup: TippyInstance[] | undefined

  return {
    onStart: (props: Record<string, unknown>) => {
      component = new VueRenderer(SlashMenu, {
        props,
        editor: props.editor as Editor,
      })

      const clientRect = props.clientRect as (() => DOMRect) | undefined
      if (!clientRect) {
        return
      }

      const element = component.element
      if (!element) {
        return
      }

      popup = tippy('body', {
        getReferenceClientRect: clientRect,
        appendTo: () => document.body,
        content: element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
      })
    },

    onUpdate(props: Record<string, unknown>) {
      component.updateProps(props)

      const clientRect = props.clientRect as (() => DOMRect) | undefined
      if (!clientRect || !popup) {
        return
      }

      popup[0].setProps({
        getReferenceClientRect: clientRect,
      })
    },

    onKeyDown(props: { event: KeyboardEvent }) {
      if (props.event.key === 'Escape') {
        popup?.[0].hide()
        return true
      }

      return component.ref?.onKeyDown(props) ?? false
    },

    onExit() {
      popup?.[0].destroy()
      component.destroy()
    },
  }
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SuggestionItem }) => {
          props.command({ editor, range })
        },
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
