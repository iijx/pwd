<script setup lang="ts">
import { computed, h } from "vue";
import { Eye, EyeOff, KeyRound, MousePointerClick, Trash2, FileText } from "lucide-vue-next";
import {
  FlexRender,
  createColumnHelper,
  getCoreRowModel,
  useVueTable,
} from "@tanstack/vue-table";
import type { AccountItem } from "@/types/vault";

const props = defineProps<{
  accounts: AccountItem[];
  selectedAccountId: string | null;
  revealedIds: string[];
}>();

const emit = defineEmits<{
  select: [id: string];
  copy: [account: AccountItem];
  toggleReveal: [id: string];
  delete: [id: string];
  openNote: [id: string];
}>();

const column = createColumnHelper<AccountItem>();

const columns = [
  column.accessor("label", {
    header: "Account",
    cell: (info) => info.getValue() || "Primary",
  }),

  column.accessor("password", {
    header: "Password",
    cell: (info) => {
      const account = info.row.original;
      const revealed = props.revealedIds.includes(account.id);
      return h("span", { class: "font-mono text-[13px]" }, revealed ? account.password : "••••••••••••");
    },
  }),

  column.display({
    id: "actions",
    header: "",
    cell: (info) => {
      const account = info.row.original;
      const revealed = props.revealedIds.includes(account.id);
      return h("div", { class: "flex items-center justify-end gap-1" }, [
        h(
          "button",
          {
            class: "icon-btn",
            title: revealed ? "Hide password" : "Reveal password",
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              emit("toggleReveal", account.id);
            },
          },
          h(revealed ? EyeOff : Eye, { size: 16 }),
        ),
        h(
          "button",
          {
            class: "icon-btn",
            title: "Secure Note",
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              emit("openNote", account.id);
            },
          },
          h(FileText, { size: 16 }),
        ),
        h(
          "button",
          {
            class: "icon-btn",
            title: "Copy password",
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              emit("copy", account);
            },
          },
          h(KeyRound, { size: 16 }),
        ),
        h(
          "button",
          {
            class: "danger-btn",
            title: "Delete account",
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              if (confirm("Are you sure you want to delete this account?")) {
                emit("delete", account.id);
              }
            },
          },
          h(Trash2, { size: 16 }),
        ),
      ]);
    },
  }),
];

const data = computed(() => props.accounts);

const table = useVueTable({
  get data() {
    return data.value;
  },
  columns,
  getCoreRowModel: getCoreRowModel(),
});
</script>

<template>
  <div v-if="accounts.length" class="account-table">
    <table>
      <thead>
        <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
          <th v-for="header in headerGroup.headers" :key="header.id">
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in table.getRowModel().rows"
          :key="row.id"
          :class="{ selected: row.original.id === selectedAccountId }"
          tabindex="0"
          @click="emit('select', row.original.id)"
          @focus="emit('select', row.original.id)"
        >
          <td v-for="cell in row.getVisibleCells()" :key="cell.id">
            <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-else class="empty-state compact">
    <MousePointerClick :size="18" />
    <span>No accounts yet.</span>
  </div>
</template>
