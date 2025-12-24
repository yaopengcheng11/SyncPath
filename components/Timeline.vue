
<template>
  <div 
    ref="containerRef"
    class="w-full flex-1 flex flex-col overflow-hidden bg-white relative transition-all select-none"
    :class="{ 'cursor-grabbing': isPanning, 'cursor-grab': isSpacePressed }"
    @mousedown="handleContainerMouseDown"
    @click="handleContainerClick"
    @wheel="handleWheel"
  >
    <!-- Project Settings Modal -->
    <div 
      v-if="showProjectSettings"
      class="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[2000] flex items-center justify-center p-6 animate-in fade-in duration-200"
      @click.stop
    >
      <div 
        class="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        @click.stop
      >
        <header class="px-10 py-8 border-b border-slate-50 flex items-center justify-between">
          <div>
            <h3 class="text-2xl font-black text-slate-800 tracking-tighter">Configuration</h3>
            <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest">Roadmap settings</p>
          </div>
          <button 
            @click.stop="showProjectSettings = false" 
            class="w-10 h-10 rounded-full hover:bg-slate-50 flex items-center justify-center text-slate-300 transition-all"
          >
            <i class="fas fa-times"></i>
          </button>
        </header>
        <div class="p-10 space-y-8">
          <div class="space-y-6">
            <div>
              <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Project Name</label>
              <input 
                :value="project.name"
                @input="e => onUpdateProject({ name: (e.target as HTMLInputElement).value })"
                class="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" 
              />
            </div>
            <div>
              <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Lead / Team</label>
              <input 
                :value="project.personnel"
                @input="e => onUpdateProject({ personnel: (e.target as HTMLInputElement).value })"
                class="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" 
              />
            </div>
            <div class="grid grid-cols-2 gap-6">
              <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Start Date</label>
                <input 
                  type="date"
                  :value="project.startDate"
                  @input="e => onUpdateProject({ startDate: (e.target as HTMLInputElement).value })"
                  class="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" 
                />
              </div>
              <div>
                <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">End Date</label>
                <input 
                  type="date"
                  :value="project.endDate"
                  @input="e => onUpdateProject({ endDate: (e.target as HTMLInputElement).value })"
                  class="w-full px-5 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-900 font-bold focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-sm" 
                />
              </div>
            </div>
          </div>

          <div class="pt-4 flex gap-4">
            <button 
              @click.stop="showProjectSettings = false" 
              class="flex-1 py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Export Options Modal -->
    <div 
      v-if="showExportModal"
      class="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[2000] flex items-center justify-center p-6 animate-in fade-in duration-200"
      @click.stop
    >
      <div 
        class="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 p-8 text-center"
        @click.stop
      >
        <div class="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-6">
          <i class="fas fa-camera"></i>
        </div>
        <h3 class="text-xl font-black text-slate-800 tracking-tight mb-2">Export Snapshot</h3>
        <p class="text-xs text-slate-500 font-medium mb-8 leading-relaxed">Choose your preferred format.</p>
        
        <div class="space-y-3">
          <button 
            @click="executeExport(false)"
            class="w-full py-4 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.15em] hover:bg-slate-800 transition-colors shadow-lg"
          >
            Standard (White BG)
          </button>
          <button 
            @click="executeExport(true)"
            class="w-full py-4 bg-white border-2 border-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] hover:bg-slate-50 hover:border-slate-200 transition-all"
          >
            Transparent (Alpha)
          </button>
        </div>
        
        <button 
          @click="showExportModal = false"
          class="mt-6 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600"
        >
          Cancel
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="absolute top-12 left-12 z-50 flex gap-4">
      <div v-for="opt in levelOptions" :key="opt.level" class="flex items-center bg-white rounded-2xl border border-slate-100 shadow-xl overflow-hidden transition-all">
        <button 
          @click.stop="visibleLevels[opt.level] = !visibleLevels[opt.level]" 
          class="flex items-center gap-3 px-4 py-2.5 transition-all"
          :class="visibleLevels[opt.level] ? 'opacity-100' : 'opacity-40 grayscale scale-95'"
        >
          <div class="w-3 h-3 rounded-full" :class="opt.color"></div>
          <span class="text-[10px] font-black text-slate-800 uppercase tracking-widest">{{ opt.label }}</span>
        </button>
        <button 
          @click.stop="lockedLevels[opt.level] = !lockedLevels[opt.level]" 
          class="px-3 py-2.5 border-l border-slate-50"
          :class="lockedLevels[opt.level] ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300'"
        >
          <i class="fas text-[10px]" :class="lockedLevels[opt.level] ? 'fa-lock' : 'fa-lock-open'"></i>
        </button>
      </div>
    </div>

    <!-- Visual Content Wrapper -->
    <div 
      ref="captureRef"
      data-capture-wrapper="true"
      class="flex-1 relative overflow-hidden flex items-center justify-center"
    >
      <div 
        data-inner-container="true"
        class="absolute origin-center transition-transform duration-75 ease-out"
        :style="{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, width: '100%', height: '100%', minWidth: '1400px' }"
      >
        <div class="w-full max-w-7xl mx-auto flex flex-col justify-center px-12 relative" :style="{ height: `${adaptiveHeight}px` }">
          <!-- Log skyline -->
          <div class="relative w-full mb-0 flex flex-col justify-end" :style="{ height: `${skylineHeight}px` }">
            <div 
              v-for="marker in logMarkers" 
              :key="marker.dateStr" 
              class="absolute bottom-0 flex flex-col items-center pointer-events-none" 
              :style="{ left: `${marker.pos}%`, transform: 'translateX(-50%)' }"
            >
              <div class="flex flex-col-reverse items-center pointer-events-auto">
                <div 
                  v-for="(log, logIdx) in marker.logList" 
                  :key="log.id"
                  @click.stop
                  @mousedown.stop="e => handleLogMouseDown(e, log, marker.dateStr)"
                  @dblclick.stop="onSelectDate(marker.dateStr, log.id)"
                  :style="{ 
                    marginBottom: logIdx === 0 ? '8px' : '-24px', 
                    zIndex: (draggingLog?.id === log.id) ? 2000 : (100 - logIdx), 
                    transform: (draggingLog?.id === log.id) 
                      ? `scale(${(draggingLog?.id === log.id && deleteDirection) ? 1.05 : 1.05}) translateY(-5px)` 
                      : (activeLogId === log.id) ? 'scale(1.05) translateY(-5px)' : 'none' 
                  }"
                  class="border p-2.5 rounded-xl shadow-sm transition-all relative overflow-hidden group"
                  :class="[
                    (!!log.isLocked || lockedLevels[log.level]) ? 'grayscale-[0.6] cursor-not-allowed' : 'cursor-grab active:cursor-grabbing',
                    (marker.isPast && activeLogId !== log.id) ? 'grayscale-[0.5] opacity-75' : 'opacity-100 grayscale-0',
                    (draggingLog?.id === log.id && deleteDirection) ? 'bg-red-50 border-red-200 ring-4 ring-red-100' : (activeLogId === log.id) ? 'ring-4 ring-indigo-500/30 border-indigo-500 bg-white' : log.level === 1 ? 'w-48 bg-slate-900 border-slate-900 text-white' : log.level === 2 ? 'w-44 bg-white border-indigo-100' : 'w-40 bg-slate-50 border-slate-200'
                  ]"
                >
                  <div v-if="draggingLog?.id === log.id && deleteDirection" class="absolute inset-0 flex items-center justify-center bg-red-500/80 backdrop-blur-sm z-50 text-white font-black uppercase text-[10px] tracking-widest animate-in fade-in duration-75">
                    Delete
                  </div>
                  <div class="flex items-center gap-2 mb-0.5 pt-1 overflow-hidden">
                    <div class="w-2 h-2 rounded-full flex-shrink-0" :class="log.level === 1 ? 'bg-amber-400' : log.level === 2 ? 'bg-indigo-50' : 'bg-slate-400'"></div>
                    <span class="text-[10px] font-black truncate uppercase tracking-tight" :class="(activeLogId === log.id) ? 'text-slate-900' : log.level === 1 ? 'text-amber-100' : 'text-slate-800'">{{ log.author }}</span>
                    <i v-if="!!log.isLocked || lockedLevels[log.level]" class="fas fa-lock text-[8px] opacity-50 ml-auto"></i>
                  </div>
                  
                  <div class="text-[8px] font-black opacity-60 mb-1.5 flex items-center gap-1" :class="log.level === 1 && activeLogId !== log.id ? 'text-amber-200' : 'text-slate-500'">
                      <i class="far fa-calendar text-[7px]"></i>
                      {{ parseSafeDate(marker.dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }}
                  </div>

                  <p class="text-[9px] line-clamp-2 italic leading-relaxed truncate" :class="(activeLogId === log.id) ? 'text-slate-500' : log.level === 1 ? 'text-slate-300' : 'text-slate-400'">{{ log.summary || "Pending update..." }}</p>
                </div>
              </div>
              <div 
                class="w-0.5 bg-gradient-to-t transition-all duration-700" 
                :class="marker.isPast ? 'opacity-30' : 'opacity-100'"
                :style="{ height: `${marker.baseStemHeight}px`, background: `linear-gradient(to top, #f1f5f9, ${marker.logList[0]?.level === 1 ? '#fbbf24' : marker.logList[0]?.level === 2 ? '#6366f1' : '#94a3b8'})` }"
              ></div>
            </div>
          </div>

          <!-- Axis -->
          <div class="relative w-full pt-4">
            <div class="absolute -top-12 left-0 w-full flex justify-between pointer-events-none">
              <div 
                v-for="(m, idx) in monthMarkers" 
                :key="idx" 
                class="absolute flex flex-col items-center" 
                :style="{ left: `${m.pos}%`, transform: 'translateX(-50%)' }"
              >
                <div class="w-px h-6 bg-slate-200 mb-2"></div>
                <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap bg-white px-2">{{ m.label }}</span>
              </div>
            </div>

            <div 
              ref="lineRef" 
              @click="handleAxisClick" 
              class="relative h-2 w-full rounded-full cursor-crosshair border border-slate-200/50"
              :style="{ background: `linear-gradient(to right, #cbd5e1 0%, #cbd5e1 ${todayPos}%, #f1f5f9 ${todayPos}%, #f1f5f9 100%)` }"
            >
              <div v-if="todayIsWithinRange" class="absolute top-1/2 -translate-y-1/2 z-[60] flex flex-col items-center pointer-events-none" :style="{ left: `${todayPos}%` }">
                <div class="w-[2px] h-6 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></div>
                <div class="absolute -top-10 px-2 py-0.5 bg-red-500 text-white text-[8px] font-black rounded shadow whitespace-nowrap animate-pulse">TODAY</div>
              </div>

              <div 
                v-for="m in logMarkers" 
                :key="m.dateStr" 
                class="absolute top-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-lg z-20 transition-all"
                :class="[
                  m.isPast ? 'opacity-60 grayscale-[0.3]' : 'opacity-100',
                  m.logList[0]?.level === 1 ? 'w-7 h-7 bg-amber-500' : m.logList[0]?.level === 2 ? 'w-6 h-6 bg-indigo-600' : 'w-5 h-5 bg-slate-400'
                ]"
                :style="{ left: `${m.pos}%`, transform: 'translate(-50%, -50%)' }"
              ></div>

              <div v-if="selectedPercentage" class="absolute top-1/2 -translate-y-1/2 z-40" :style="{ left: `${selectedPercentage}%` }" @click.stop>
                <button @click="showLevelMenu = true" class="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-xl transform -translate-x-1/2 -translate-y-16 border-2 border-white"><i class="fas fa-plus"></i></button>
                <div v-if="showLevelMenu" class="absolute -translate-x-1/2 -translate-y-[260px] bg-white border border-slate-100 shadow-2xl rounded-2xl p-2 flex flex-col gap-1 min-w-[160px]">
                  <button 
                    v-for="opt in levelOptions" 
                    :key="opt.level" 
                    @click="onSelectDate(selectedDate!, undefined, opt.level)" 
                    class="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50"
                  >
                    <div class="w-3 h-3 rounded-full" :class="opt.color"></div>
                    <span class="text-[10px] font-black text-slate-800 uppercase">{{ opt.label }}</span>
                  </button>
                </div>
              </div>
            </div>
            
            <div class="mt-10 flex justify-between text-[11px] font-black text-slate-400 uppercase tracking-widest px-2">
              <span>{{ new Date(project.startDate).toLocaleDateString() }}</span>
              <span>{{ new Date(project.endDate).toLocaleDateString() }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer class="px-12 py-5 bg-slate-50 border-t border-slate-100 flex items-center justify-between z-10">
      <div class="flex items-center gap-4"><h2 class="text-sm font-black text-slate-800 tracking-tight">{{ project.name }}</h2><div class="w-px h-6 bg-slate-200"></div><p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">{{ project.personnel }}</p></div>
      <div class="flex gap-4">
        <button 
          @click="showExportModal = true"
          :disabled="isExporting"
          class="text-[9px] font-black text-emerald-600 uppercase tracking-widest border border-slate-200 px-4 py-2 rounded-full bg-white shadow-sm flex items-center gap-2 hover:bg-emerald-50 transition-colors disabled:opacity-50"
        >
          <i class="fas" :class="isExporting ? 'fa-spinner fa-spin' : 'fa-camera'"></i> {{ isExporting ? 'Processing...' : 'Snapshot' }}
        </button>
        <button 
          @click.stop="showProjectSettings = true" 
          class="text-[9px] font-black text-slate-600 uppercase tracking-widest border border-slate-200 px-4 py-2 rounded-full bg-white shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-colors"
        >
          <i class="fas fa-sliders-h"></i> Settings
        </button>
        <button @click="transform = { x: 0, y: 0, scale: 1 }" class="text-[9px] font-black text-slate-400 uppercase tracking-widest border border-slate-200 px-4 py-2 rounded-full bg-white transition-all hover:bg-slate-50 active:translate-y-0.5">Reset View (H)</button>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { formatDate, parseSafeDate } from '../utils/dateUtils';
import { WorkLog, Project, LogLevel } from '../types';
import html2canvas from 'html2canvas';

const props = defineProps<{
  logs: Record<string, WorkLog[]>;
  project: Project;
}>();

const emit = defineEmits<{
  (e: 'selectDate', dateStr: string, logId?: string, level?: LogLevel): void;
  (e: 'moveLog', logId: string, oldDate: string, newDate: string): void;
  (e: 'updateProject', updates: Partial<Project>): void;
  (e: 'deleteLog', logId: string, dateStr: string): void;
  (e: 'toggleLock', logId: string, dateStr: string): void;
}>();

const onSelectDate = (dateStr: string, logId?: string, level?: LogLevel) => emit('selectDate', dateStr, logId, level);
const onMoveLog = (logId: string, oldDate: string, newDate: string) => emit('moveLog', logId, oldDate, newDate);
const onUpdateProject = (updates: Partial<Project>) => emit('updateProject', updates);
const onDeleteLog = (logId: string, dateStr: string) => emit('deleteLog', logId, dateStr);

interface DragState {
  id: string;
  oldDate: string;
  level: LogLevel;
  isLocked: boolean;
}

const selectedDate = ref<string | null>(null);
const selectedPercentage = ref<number | null>(null);
const activeLogId = ref<string | null>(null);
const showLevelMenu = ref(false);
const showProjectSettings = ref(false);
const showExportModal = ref(false);
const isExporting = ref(false);

const transform = ref({ x: 0, y: 0, scale: 1 });
const isSpacePressed = ref(false);
const isPanning = ref(false);

const draggingLog = ref<DragState | null>(null);
const dragStartPos = ref<{ x: number, y: number } | null>(null);
const hasMovedEnough = ref(false);
const deleteDirection = ref<'left' | 'right' | null>(null);

const visibleLevels = ref<Record<LogLevel, boolean>>({ 1: true, 2: true, 3: true });
const lockedLevels = ref<Record<LogLevel, boolean>>({ 1: false, 2: false, 3: false });

const lineRef = ref<HTMLDivElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const captureRef = ref<HTMLDivElement | null>(null);
const lastMousePos = ref({ x: 0, y: 0 });

const projectStart = computed(() => parseSafeDate(props.project.startDate));
const projectEnd = computed(() => parseSafeDate(props.project.endDate));
const totalDurationMs = computed(() => projectEnd.value.getTime() - projectStart.value.getTime());

const now = computed(() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
});

const getPosFromDate = (dateStr: string) => {
  const d = parseSafeDate(dateStr);
  const diff = d.getTime() - projectStart.value.getTime();
  return (diff / totalDurationMs.value) * 100;
};

const todayInfo = computed(() => {
  const diff = now.value.getTime() - projectStart.value.getTime();
  const pos = (diff / totalDurationMs.value) * 100;
  return {
    todayPos: Math.max(0, Math.min(100, pos)),
    todayIsWithinRange: diff >= 0 && diff <= totalDurationMs.value
  };
});

const todayPos = computed(() => todayInfo.value.todayPos);
const todayIsWithinRange = computed(() => todayInfo.value.todayIsWithinRange);

const getDeleteDirection = (clientX: number) => {
  if (!lineRef.value) return null;
  const rect = lineRef.value.getBoundingClientRect();
  if (clientX < rect.left) return 'left';
  if (clientX > rect.right) return 'right';
  return null;
};

const handleGlobalMouseMove = (e: MouseEvent) => {
  if (isPanning.value) {
    const dx = e.clientX - lastMousePos.value.x;
    const dy = e.clientY - lastMousePos.value.y;
    transform.value = { ...transform.value, x: transform.value.x + dx, y: transform.value.y + dy };
    lastMousePos.value = { x: e.clientX, y: e.clientY };
    return;
  }

  if (draggingLog.value && dragStartPos.value) {
    if (!hasMovedEnough.value) {
      const dist = Math.sqrt(Math.pow(e.clientX - dragStartPos.value.x, 2) + Math.pow(e.clientY - dragStartPos.value.y, 2));
      if (dist > 5) hasMovedEnough.value = true;
    }
    deleteDirection.value = getDeleteDirection(e.clientX);
  }
};

const handleGlobalMouseUp = (e: MouseEvent) => {
  if (draggingLog.value && hasMovedEnough.value) {
    const direction = getDeleteDirection(e.clientX);
    if (direction) {
      if (!draggingLog.value.isLocked && !lockedLevels.value[draggingLog.value.level]) {
        onDeleteLog(draggingLog.value.id, draggingLog.value.oldDate);
      }
    } else if (lineRef.value) {
      const rect = lineRef.value.getBoundingClientRect();
      const rawPercentage = (e.clientX - rect.left) / rect.width;
      const percentage = Math.max(0, Math.min(1, rawPercentage));
      const targetTime = projectStart.value.getTime() + (totalDurationMs.value * percentage);
      const targetDateStr = formatDate(new Date(targetTime));

      if (targetDateStr && targetDateStr !== draggingLog.value.oldDate) {
         if (!draggingLog.value.isLocked && !lockedLevels.value[draggingLog.value.level]) {
            onMoveLog(draggingLog.value.id, draggingLog.value.oldDate, targetDateStr);
         }
      }
    }
  }
  isPanning.value = false;
  draggingLog.value = null;
  dragStartPos.value = null;
  hasMovedEnough.value = false;
  deleteDirection.value = null;
};

const handleLogMouseDown = (e: MouseEvent, log: WorkLog, dateStr: string) => {
  activeLogId.value = log.id;
  const isLocked = !!log.isLocked || lockedLevels.value[log.level];
  if (!isLocked && e.button === 0) {
    draggingLog.value = { id: log.id, oldDate: dateStr, level: log.level, isLocked: !!log.isLocked };
    dragStartPos.value = { x: e.clientX, y: e.clientY };
  }
};

const handleContainerMouseDown = (e: MouseEvent) => {
  if (isSpacePressed.value) {
    isPanning.value = true;
    lastMousePos.value = { x: e.clientX, y: e.clientY };
  }
};

const handleContainerClick = () => {
  selectedDate.value = null;
  selectedPercentage.value = null;
  activeLogId.value = null;
};

const handleAxisClick = (e: MouseEvent) => {
  e.stopPropagation();
  if (isPanning.value || draggingLog.value || !lineRef.value) return;
  const rect = lineRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const percentage = Math.max(0, Math.min(1, x / rect.width));
  const time = projectStart.value.getTime() + (percentage * totalDurationMs.value);
  const dateStr = formatDate(new Date(time));
  selectedDate.value = dateStr;
  selectedPercentage.value = percentage * 100;
  showLevelMenu.value = false;
};

const handleWheel = (e: WheelEvent) => {
  const zoomIntensity = 0.05;
  const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
  const newScale = Math.max(0.1, Math.min(5, transform.value.scale * (1 + delta)));
  transform.value = { ...transform.value, scale: newScale };
};

const executeExport = async (withAlpha: boolean) => {
  if (!captureRef.value) return;
  showExportModal.value = false;
  isExporting.value = true;
  
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    // Reduced from 3200 to 1920 to keep resolution reasonable (approx 4K width with scale 2)
    const EXPORT_WIDTH = 1920; 
    
    const canvas = await html2canvas(captureRef.value, {
      backgroundColor: withAlpha ? null : '#ffffff',
      scale: 2, // Reduced from 3 to 2 for better performance/size
      logging: false,
      useCORS: true,
      windowWidth: EXPORT_WIDTH,
      onclone: (clonedDoc) => {
        const wrapper = clonedDoc.querySelector('[data-capture-wrapper]') as HTMLElement;
        const inner = clonedDoc.querySelector('[data-inner-container]') as HTMLElement;
        
        if (wrapper && inner) {
           wrapper.style.width = `${EXPORT_WIDTH}px`;
           wrapper.style.height = 'auto';
           wrapper.style.overflow = 'visible';
           inner.style.transform = 'none';
           inner.style.width = '100%';
           inner.style.height = 'auto';
        }

        const truncatedElements = clonedDoc.querySelectorAll('.truncate');
        truncatedElements.forEach((el) => {
          const element = el as HTMLElement;
          element.classList.remove('truncate');
          element.style.whiteSpace = 'normal';
          element.style.overflow = 'visible';
          element.style.height = 'auto';
        });
      }
    });
    
    const link = document.createElement('a');
    link.download = `${props.project.name.replace(/\s+/g, '-').toLowerCase()}-snapshot.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) {
    console.error('Export failed:', error);
    alert('Failed to generate image. Please try again.');
  } finally {
    isExporting.value = false;
  }
};

const logMarkers = computed(() => {
  const rawEntries = (Object.entries(props.logs) as [string, WorkLog[]][])
    .filter(([dateStr]) => {
      const d = parseSafeDate(dateStr);
      return d >= projectStart.value && d <= projectEnd.value;
    })
    .sort((a, b) => a[0].localeCompare(b[0]));

  return rawEntries.map(([dateStr, logList]) => {
    const filteredList = logList.filter(l => visibleLevels.value[l.level]);
    if (filteredList.length === 0) return null;
    
    const highestLevelInDate = Math.min(...filteredList.map(l => l.level)) as LogLevel;
    const baseStemHeight = highestLevelInDate === 1 ? 320 : highestLevelInDate === 2 ? 180 : 80;
    const isPast = parseSafeDate(dateStr).getTime() < now.value.getTime();
    
    return {
      dateStr,
      pos: getPosFromDate(dateStr),
      baseStemHeight,
      isPast,
      logList: [...filteredList].sort((a, b) => (b.level || 3) - (a.level || 3))
    };
  }).filter(m => m !== null) as any[];
});

const monthMarkers = computed(() => {
  const markers: { label: string, pos: number }[] = [];
  const current = new Date(projectStart.value);
  current.setDate(1); 
  if (current < projectStart.value) current.setMonth(current.getMonth() + 1);
  while (current <= projectEnd.value) {
    markers.push({ label: current.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), pos: getPosFromDate(formatDate(current)) });
    current.setMonth(current.getMonth() + 1);
  }
  return markers;
});

const skylineHeight = computed(() => 400 + (Math.max(0, ...logMarkers.value.map(m => m.logList.length)) * 40));
const adaptiveHeight = computed(() => Math.max(900, skylineHeight.value + 350));

const levelOptions = [
  { level: 1 as LogLevel, label: 'Primary', icon: 'fa-circle', color: 'bg-amber-500' },
  { level: 2 as LogLevel, label: 'Secondary', icon: 'fa-square', color: 'bg-indigo-500' },
  { level: 3 as LogLevel, label: 'Minor', icon: 'fa-diamond', color: 'bg-slate-400' },
];

onMounted(() => {
  window.addEventListener('mousemove', handleGlobalMouseMove);
  window.addEventListener('mouseup', handleGlobalMouseUp);

  const handleKeyDown = (e: KeyboardEvent) => {
    const isInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
    if (e.code === 'Space') { 
      isSpacePressed.value = true; 
      if (!isInput) e.preventDefault(); 
    }
    
    if (isInput) return;

    if (e.key.toLowerCase() === 'h') transform.value = { x: 0, y: 0, scale: 1 };
    if (e.key === 'Escape') { 
      selectedDate.value = null; 
      selectedPercentage.value = null; 
      showLevelMenu.value = false; 
      activeLogId.value = null;
      showProjectSettings.value = false;
      showExportModal.value = false;
    }

    if (activeLogId.value && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      let targetLog: WorkLog | null = null;
      let currentDateStr = '';

      for (const [date, list] of Object.entries(props.logs)) {
        const found = list.find(l => l.id === activeLogId.value);
        if (found) {
          targetLog = found;
          currentDateStr = date;
          break;
        }
      }

      if (targetLog && currentDateStr) {
        if (targetLog.isLocked || lockedLevels.value[targetLog.level]) return;

        const current = parseSafeDate(currentDateStr);
        const direction = e.key === 'ArrowRight' ? 1 : -1;
        current.setDate(current.getDate() + direction);
        const newDateStr = formatDate(current);

        onMoveLog(activeLogId.value!, currentDateStr, newDateStr);
      }
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') { isSpacePressed.value = false; isPanning.value = false; } };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  onUnmounted(() => {
    window.removeEventListener('mousemove', handleGlobalMouseMove);
    window.removeEventListener('mouseup', handleGlobalMouseUp);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  });
});
</script>
