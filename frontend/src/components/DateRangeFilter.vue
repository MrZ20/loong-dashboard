<script setup lang="ts">
import {
  computed,
  ref,
  watch,
} from "vue";
import { usePopover } from "../composables/usePopover";
import { recentBeijingDateRange } from "../domain/community-date-range";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  from: string;
  to: string;
}>();

const emit = defineEmits<{
  "update:from": [value: string];
  "update:to": [value: string];
}>();

const { root, trigger, open, close, toggle } = usePopover();
const today = recentBeijingDateRange(1).to;
const calendarCursor = ref(monthStart(props.to || props.from || today));
const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
const active = computed(() => Boolean(props.from || props.to));
const rangeLabel = computed(() => {
  if (!active.value) return "全部日期";
  if (props.from && props.from === props.to) return props.from;
  if (props.from && !props.to) return `${props.from} 起`;
  return `${props.from || "最早"} 至 ${props.to || "今天"}`;
});
const calendarTitle = computed(() => {
  const cursor = parseDate(calendarCursor.value);
  return `${cursor.getUTCFullYear()}年${String(cursor.getUTCMonth() + 1).padStart(2, "0")}月`;
});
const calendarDays = computed(() => {
  const first = parseDate(calendarCursor.value);
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    const value = formatDate(date);
    return {
      value,
      day: date.getUTCDate(),
      currentMonth: date.getUTCMonth() === first.getUTCMonth(),
      today: value === today,
      rangeStart: value === props.from,
      rangeEnd: value === props.to,
      inRange: Boolean(
        props.from && props.to && value > props.from && value < props.to,
      ),
    };
  });
});
const selectionHint = computed(() => {
  if (props.from && !props.to) return "请选择结束日期";
  if (props.from && props.to) return "已选择更新时间范围";
  return "先选择开始日期，再选择结束日期";
});

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function formatDate(value: Date) {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function monthStart(value: string) {
  const date = parseDate(value);
  date.setUTCDate(1);
  return formatDate(date);
}

function applyPreset(days: number) {
  const range = recentBeijingDateRange(days);
  emit("update:from", range.from);
  emit("update:to", range.to);
  close(true);
}

function changeMonth(offset: number) {
  const cursor = parseDate(calendarCursor.value);
  cursor.setUTCMonth(cursor.getUTCMonth() + offset, 1);
  calendarCursor.value = formatDate(cursor);
}

function selectDate(value: string) {
  if (!props.from || props.to) {
    emit("update:from", value);
    emit("update:to", "");
    return;
  }

  if (value < props.from) {
    emit("update:from", value);
    emit("update:to", props.from);
  } else {
    emit("update:to", value);
  }
}

function clear() {
  emit("update:from", "");
  emit("update:to", "");
  close(true);
}

watch(open, (isOpen) => {
  if (isOpen) calendarCursor.value = monthStart(props.to || props.from || today);
});
</script>

<template>
  <div ref="root" class="date-range-filter" :class="{ 'date-range-filter--open': open }">
    <button
      ref="trigger"
      class="date-range-filter__trigger"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
      @keydown.esc="close(true)"
    >
      <span class="date-range-filter__icon" :data-active="active">
        <Octicon name="calendar" :size="14" />
      </span>
      <span class="date-range-filter__copy">
        <span>更新时间</span>
        <strong>{{ rangeLabel }}</strong>
      </span>
      <Octicon name="chevron-down" :size="13" />
    </button>

    <Transition name="filter-menu">
      <div v-if="open" class="date-range-filter__panel" role="dialog" aria-label="更新时间范围">
        <header>
          <span>按 GitHub 更新时间筛选</span>
          <small>日期按北京时间计算</small>
        </header>
        <div class="date-range-filter__presets">
          <button type="button" @click="applyPreset(1)">今天</button>
          <button type="button" @click="applyPreset(3)">最近 3 天</button>
          <button type="button" @click="applyPreset(7)">最近 7 天</button>
        </div>
        <div class="date-range-filter__selection" aria-live="polite">
          <span :data-filled="Boolean(from)">
            <small>开始日期</small>
            <strong>{{ from || "请选择" }}</strong>
          </span>
          <Octicon name="arrow-right" :size="13" />
          <span :data-filled="Boolean(to)">
            <small>结束日期</small>
            <strong>{{ to || "请选择" }}</strong>
          </span>
        </div>
        <section class="date-range-filter__calendar" aria-label="日期日历">
          <div class="date-range-filter__calendar-heading">
            <strong>{{ calendarTitle }}</strong>
            <div>
              <button type="button" aria-label="上个月" @click="changeMonth(-1)">
                <Octicon name="chevron-left" :size="15" />
              </button>
              <button type="button" aria-label="下个月" @click="changeMonth(1)">
                <Octicon name="chevron-right" :size="15" />
              </button>
            </div>
          </div>
          <div class="date-range-filter__weekdays" aria-hidden="true">
            <span v-for="weekday in weekdays" :key="weekday">{{ weekday }}</span>
          </div>
          <div class="date-range-filter__days">
            <button
              v-for="day in calendarDays"
              :key="day.value"
              type="button"
              :class="{
                'is-outside': !day.currentMonth,
                'is-today': day.today,
                'is-in-range': day.inRange,
                'is-range-start': day.rangeStart,
                'is-range-end': day.rangeEnd,
              }"
              :aria-label="day.value"
              :aria-pressed="day.rangeStart || day.rangeEnd"
              @click="selectDate(day.value)"
            >
              {{ day.day }}
            </button>
          </div>
        </section>
        <p class="date-range-filter__hint">{{ selectionHint }}</p>
        <footer>
          <button type="button" class="button button--ghost" :disabled="!active" @click="clear">清除日期</button>
          <button
            type="button"
            class="button button--primary"
            :disabled="Boolean(from) && !to"
            @click="close(true)"
          >
            完成
          </button>
        </footer>
      </div>
    </Transition>
  </div>
</template>
