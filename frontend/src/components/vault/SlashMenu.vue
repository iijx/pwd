<template>
  <div class="slash-menu">
    <template v-if="items.length">
      <button
        class="slash-item"
        :class="{ 'is-selected': index === selectedIndex }"
        v-for="(item, index) in items"
        :key="index"
        @click="selectItem(index)"
      >
        {{ item.title }}
      </button>
    </template>
    <div class="slash-empty" v-else>
      No result
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps({
  items: {
    type: Array as () => any[],
    required: true,
  },
  command: {
    type: Function,
    required: true,
  },
})

const selectedIndex = ref(0)

watch(() => props.items, () => {
  selectedIndex.value = 0
})

const onKeyDown = ({ event }: { event: KeyboardEvent }) => {
  if (event.key === 'ArrowUp') {
    selectedIndex.value = ((selectedIndex.value + props.items.length) - 1) % props.items.length
    return true
  }

  if (event.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % props.items.length
    return true
  }

  if (event.key === 'Enter') {
    selectItem(selectedIndex.value)
    return true
  }

  return false
}

const selectItem = (index: number) => {
  const item = props.items[index]

  if (item) {
    props.command(item)
  }
}

defineExpose({
  onKeyDown
})
</script>

<style scoped>
.slash-menu {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  padding: 0.25rem;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.5), 0 4px 6px -4px rgb(0 0 0 / 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 180px;
}

.slash-item {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 0.25rem;
  padding: 0.5rem 0.75rem;
  color: #e2e8f0;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.1s;
}

.slash-item.is-selected,
.slash-item:hover {
  background: #3b82f6;
  color: #ffffff;
}

.slash-empty {
  padding: 0.5rem;
  color: #94a3b8;
  font-size: 0.875rem;
  text-align: center;
}
</style>
