import React, { useState, useEffect, useRef } from 'react'
import { motion, Reorder, useDragControls } from 'framer-motion'
import type { AppSettings, ReminderCategory, SubReminder, CountdownItem } from '../types'
import { getStableDefaultCategories, genId } from '../types'

/** 每次使用时读取，避免模块加载时 preload 尚未注入 */
function getApi() {
  return window.electronAPI
}

const defaultSettings: AppSettings = {
  reminderCategories: getStableDefaultCategories(),
}

function formatRemaining(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** 时间漏斗图标，用于倒计时区域 */
function HourglassIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 4h12M6 20h12M6 4l6 8 6-8M6 20l6-8 6 8" />
    </svg>
  )
}

type SubReminderRowProps = {
  item: SubReminder
  categoryIndex: number
  itemIndex: number
  categoryId: string
  countdowns: CountdownItem[]
  updateItem: (ci: number, ii: number, patch: Partial<SubReminder>) => void
  removeItem: (ci: number, ii: number) => void
  getPresets: (ci: number) => string[]
  applyPresetToItem: (ci: number, ii: number, text: string) => void
  presetDropdown: { categoryIndex: number; itemIndex: number } | null
  setPresetDropdown: (v: { categoryIndex: number; itemIndex: number } | null) => void
  setPresetModal: (v: { categoryIndex: number; itemIndex: number | null } | null) => void
  hoverItemHandle: { ci: number; ii: number; side: 'left' | 'right' } | null
  setHoverItemHandle: (v: { ci: number; ii: number; side: 'left' | 'right' } | null) => void
  dragConstraintsRef: React.RefObject<HTMLElement | null>
  onDragStart?: () => void
  onDragEnd?: () => void
  repeatDropdown: { categoryIndex: number; itemIndex: number } | null
  setRepeatDropdown: (v: { categoryIndex: number; itemIndex: number } | null) => void
}

/** 重复次数控件：输入框（∞ 或数字）+ 加减 + 右侧三角下拉（hover 显），选项为 自定义 / ∞ */
function RepeatControl({
  categoryIndex,
  itemIndex,
  repeatCount,
  updateItem,
  repeatDropdown,
  setRepeatDropdown,
}: {
  categoryIndex: number
  itemIndex: number
  repeatCount: number | null
  updateItem: (ci: number, ii: number, patch: Partial<SubReminder>) => void
  repeatDropdown: { categoryIndex: number; itemIndex: number } | null
  setRepeatDropdown: (v: { categoryIndex: number; itemIndex: number } | null) => void
}) {
  const isRepeatOpen = repeatDropdown?.categoryIndex === categoryIndex && repeatDropdown?.itemIndex === itemIndex
  return (
    <div className="relative flex items-center group flex-shrink-0">
      {repeatCount === null ? (
        <input
          type="text"
          readOnly
          value="∞"
          className="w-10 rounded border border-slate-300 px-1.5 py-1 text-sm text-center bg-white"
          aria-label="重复次数"
        />
      ) : (
        <input
          type="number"
          min={1}
          max={999}
          value={repeatCount}
          onChange={(e) => updateItem(categoryIndex, itemIndex, { repeatCount: Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1)) })}
          className="w-10 rounded border border-slate-300 px-1.5 py-1 text-sm text-center"
          aria-label="重复次数"
        />
      )}
      <button
        type="button"
        onClick={() => setRepeatDropdown(isRepeatOpen ? null : { categoryIndex, itemIndex })}
        className={`flex items-center justify-center rounded p-0.5 text-slate-400 transition-opacity duration-200 ease-out hover:text-slate-600 focus:outline-none ${isRepeatOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        title="重复"
        aria-label="重复选项"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${isRepeatOpen ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isRepeatOpen && (
        <div className="absolute top-full right-0 mt-1 z-10 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[100px]">
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100"
            onClick={() => { updateItem(categoryIndex, itemIndex, { repeatCount: repeatCount ?? 1 }); setRepeatDropdown(null) }}
          >
            自定义
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100"
            onClick={() => { updateItem(categoryIndex, itemIndex, { repeatCount: null }); setRepeatDropdown(null) }}
          >
            ∞
          </button>
        </div>
      )}
    </div>
  )
}

function SubReminderRow({
  item,
  categoryIndex,
  itemIndex,
  categoryId,
  countdowns,
  updateItem,
  removeItem,
  getPresets,
  applyPresetToItem,
  presetDropdown,
  setPresetDropdown,
  setPresetModal,
  hoverItemHandle,
  setHoverItemHandle,
  dragConstraintsRef,
  onDragStart,
  onDragEnd,
  repeatDropdown,
  setRepeatDropdown,
}: SubReminderRowProps) {
  const controls = useDragControls()
  const presetAreaRef = useRef<HTMLDivElement>(null)
  const repeatAreaRef = useRef<HTMLDivElement>(null)
  const countdownKey = `${categoryId}_${item.id}`
  const cd = countdowns.find((c) => c.key === countdownKey)
  const isPresetOpen = presetDropdown?.categoryIndex === categoryIndex && presetDropdown?.itemIndex === itemIndex
  const isRepeatOpen = repeatDropdown?.categoryIndex === categoryIndex && repeatDropdown?.itemIndex === itemIndex

  /** 进度条剩余比例 0~1；结束/暂停/重置时为 1（全绿） */
  const progressRatio = (() => {
    if (!cd) return 1
    if (cd.type === 'fixed') {
      const totalMs = 24 * 3600 * 1000
      if (cd.remainingMs <= 0) return 1
      return Math.min(1, cd.remainingMs / totalMs)
    }
    const totalMs = item.mode === 'interval'
      ? ((item.intervalHours ?? 0) * 3600 + item.intervalMinutes * 60 + (item.intervalSeconds ?? 0)) * 1000
      : 0
    if (totalMs <= 0) return 1
    if (cd.remainingMs <= 0) return 1
    if (cd.repeatCount != null && cd.firedCount != null && cd.firedCount >= cd.repeatCount) return 1
    return Math.min(1, cd.remainingMs / totalMs)
  })()

  useEffect(() => {
    if (!isPresetOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (presetAreaRef.current && !presetAreaRef.current.contains(e.target as Node)) {
        setPresetDropdown(null)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [isPresetOpen, setPresetDropdown])

  useEffect(() => {
    if (!isRepeatOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (repeatAreaRef.current && !repeatAreaRef.current.contains(e.target as Node)) {
        setRepeatDropdown(null)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [isRepeatOpen, setRepeatDropdown])

  return (
    <Reorder.Item
      value={item}
      as="div"
      dragListener={false}
      dragControls={controls}
      dragConstraints={dragConstraintsRef}
      dragElastic={0}
      transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.12 }}
      dragTransition={{ bounceStiffness: 400, bounceDamping: 40 }}
      style={{ position: 'relative' }}
      className="flex flex-col gap-1.5 p-3 rounded-lg bg-slate-50 transition-colors"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={{
        scale: 1.02,
        boxShadow: '0 4px 16px -2px rgba(0,0,0,0.08)',
        backgroundColor: 'rgb(241 245 249)',
        zIndex: 9999,
      }}
    >
      <div className="flex flex-nowrap items-center gap-2">
      <div
        className="min-w-[1.5rem] w-6 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => controls.start(e)}
        onMouseEnter={() => setHoverItemHandle({ ci: categoryIndex, ii: itemIndex, side: 'left' })}
        onMouseLeave={() => setHoverItemHandle(null)}
        title="拖动调整子项顺序"
      >
        <span
          className={`select-none touch-none transition-opacity ${hoverItemHandle?.ci === categoryIndex && hoverItemHandle?.ii === itemIndex && hoverItemHandle?.side === 'left' ? 'opacity-100 text-slate-500' : 'opacity-0 text-slate-400'}`}
          aria-hidden
        >
          ⋮⋮
        </span>
      </div>
      {item.mode === 'fixed' ? (
        <input
          type="time"
          value={item.time}
          onChange={(e) => updateItem(categoryIndex, itemIndex, { time: e.target.value })}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        />
      ) : (
        <>
          <div className="flex items-center gap-2 shrink-0 ml-3">
          <span className="text-slate-500 text-sm shrink-0">倒计时</span>
          <input
            type="number"
            min={0}
            max={23}
            value={item.intervalHours ?? 0}
            onChange={(e) => updateItem(categoryIndex, itemIndex, { intervalHours: Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)) })}
            className="w-12 rounded border border-slate-300 px-1.5 py-1 text-sm text-right"
          />
          <span className="text-slate-500 text-sm shrink-0">时</span>
          <input
            type="number"
            min={0}
            max={59}
            value={item.intervalMinutes}
            onChange={(e) => updateItem(categoryIndex, itemIndex, { intervalMinutes: Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)) })}
            className="w-12 rounded border border-slate-300 px-1.5 py-1 text-sm text-right"
          />
          <span className="text-slate-500 text-sm shrink-0">分</span>
          <input
            type="number"
            min={0}
            max={59}
            value={item.intervalSeconds ?? 0}
            onChange={(e) => updateItem(categoryIndex, itemIndex, { intervalSeconds: Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)) })}
            className="w-12 rounded border border-slate-300 px-1.5 py-1 text-sm text-right"
          />
          <span className="text-slate-500 text-sm shrink-0">秒</span>
          <div ref={repeatAreaRef} className="flex items-center gap-1.5">
            <span className="flex items-center justify-center text-slate-500 shrink-0" title="重复次数" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 1l4 4-4 4" />
                <path d="M3 11V9a4 4 0 014-4h14" />
                <path d="M7 23l-4-4 4-4" />
                <path d="M21 13v2a4 4 0 01-4 4H3" />
              </svg>
            </span>
            <RepeatControl
              categoryIndex={categoryIndex}
              itemIndex={itemIndex}
              repeatCount={item.repeatCount}
              updateItem={updateItem}
              repeatDropdown={repeatDropdown}
              setRepeatDropdown={setRepeatDropdown}
            />
          </div>
          </div>
        </>
      )}
      <div ref={presetAreaRef} className="relative flex flex-1 min-w-0 items-center group">
        <input
          type="text"
          value={item.content}
          onChange={(e) => updateItem(categoryIndex, itemIndex, { content: e.target.value })}
          placeholder="提醒内容"
          className="w-full min-w-0 rounded border border-slate-300 pl-2 pr-8 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => setPresetDropdown(isPresetOpen ? null : { categoryIndex, itemIndex })}
          className={`absolute right-1.5 flex items-center justify-center rounded p-0.5 text-slate-400 transition-opacity duration-200 ease-out hover:text-slate-600 focus:outline-none ${isPresetOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          title="选预设"
          aria-label="选预设"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${isPresetOpen ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {isPresetOpen && (
          <div className="absolute top-full right-0 mt-1 z-10 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-48 overflow-auto min-w-[180px]">
            {getPresets(categoryIndex).map((p, i) => (
              <button
                key={i}
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100"
                onClick={() => applyPresetToItem(categoryIndex, itemIndex, p)}
              >
                {p || '(空)'}
              </button>
            ))}
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 border-t border-slate-100"
              onClick={() => { setPresetDropdown(null); setPresetModal({ categoryIndex, itemIndex }) }}
            >
              管理预设…
            </button>
          </div>
        )}
      </div>
      <button type="button" onClick={() => removeItem(categoryIndex, itemIndex)} className="text-red-600 hover:text-red-700 text-sm shrink-0">
        删除
      </button>
      <div
        className="min-w-[1.5rem] w-6 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => controls.start(e)}
        onMouseEnter={() => setHoverItemHandle({ ci: categoryIndex, ii: itemIndex, side: 'right' })}
        onMouseLeave={() => setHoverItemHandle(null)}
        title="拖动调整子项顺序"
      >
        <span
          className={`select-none touch-none transition-opacity ${hoverItemHandle?.ci === categoryIndex && hoverItemHandle?.ii === itemIndex && hoverItemHandle?.side === 'right' ? 'opacity-100 text-slate-500' : 'opacity-0 text-slate-400'}`}
          aria-hidden
        >
          ⋮⋮
        </span>
      </div>
      </div>
      {cd && (
        <div className="flex flex-col gap-1 pl-8 min-w-0 w-full">
          {/* 第二行：倒计时时间，位置随进度条边界实时移动 */}
          <div className="relative h-6 w-full">
            <div
              className="absolute flex items-center gap-1.5 text-slate-600 text-sm whitespace-nowrap transition-[left] duration-300 ease-out -translate-x-1/2"
              style={{ left: `${(1 - progressRatio) * 100}%` }}
            >
              <HourglassIcon className="shrink-0 text-slate-500" />
              <span>{formatRemaining(cd.remainingMs)}</span>
            </div>
          </div>
          {/* 第三行：仅进度条 */}
          <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden flex">
            <div className="bg-slate-200 transition-[width] duration-300 ease-out h-full" style={{ width: `${(1 - progressRatio) * 100}%` }} />
            <div className="bg-green-500 transition-[width] duration-300 ease-out shrink-0 h-full" style={{ width: `${progressRatio * 100}%` }} />
          </div>
        </div>
      )}
    </Reorder.Item>
  )
}

type CategoryCardProps = {
  cat: ReminderCategory
  realCi: number
  updateCategory: (ci: number, patch: Partial<ReminderCategory>) => void
  removeCategory: (ci: number) => void
  setPresetModal: (v: { categoryIndex: number; itemIndex: number | null } | null) => void
  addItemForCategory: number | null
  setAddItemForCategory: (v: number | null) => void
  addItem: (ci: number, mode: 'fixed' | 'interval') => void
  listContainerRefsMap: React.MutableRefObject<Record<string, React.RefObject<HTMLDivElement | null>>>
  setCategoryItems: (ci: number, items: SubReminder[]) => void
  updateItem: (ci: number, ii: number, patch: Partial<SubReminder>) => void
  removeItem: (ci: number, ii: number) => void
  getPresets: (ci: number) => string[]
  applyPresetToItem: (ci: number, ii: number, text: string) => void
  presetDropdown: { categoryIndex: number; itemIndex: number } | null
  setPresetDropdown: (v: { categoryIndex: number; itemIndex: number } | null) => void
  repeatDropdown: { categoryIndex: number; itemIndex: number } | null
  setRepeatDropdown: (v: { categoryIndex: number; itemIndex: number } | null) => void
  hoverItemHandle: { ci: number; ii: number; side: 'left' | 'right' } | null
  setHoverItemHandle: (v: { ci: number; ii: number; side: 'left' | 'right' } | null) => void
  hoverCategoryHandle: { ci: number; side: 'left' | 'right' } | null
  setHoverCategoryHandle: (v: { ci: number; side: 'left' | 'right' } | null) => void
  countdowns: CountdownItem[]
}

function CategoryCard(props: CategoryCardProps) {
  const {
    cat,
    realCi,
    updateCategory,
    removeCategory,
    setPresetModal,
    addItemForCategory,
    setAddItemForCategory,
    addItem,
    listContainerRefsMap,
    setCategoryItems,
    updateItem,
    removeItem,
    getPresets,
    applyPresetToItem,
    presetDropdown,
    setPresetDropdown,
    repeatDropdown,
    setRepeatDropdown,
    hoverItemHandle,
    setHoverItemHandle,
    hoverCategoryHandle,
    setHoverCategoryHandle,
    countdowns,
  } = props
  const controls = useDragControls()
  const [isChildDragging, setIsChildDragging] = useState(false)
  let listRef = listContainerRefsMap.current[cat.id]
  if (!listRef) {
    listRef = { current: null }
    listContainerRefsMap.current[cat.id] = listRef
  }
  return (
    <Reorder.Item
      value={cat}
      as="div"
      dragListener={false}
      dragControls={controls}
      transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.12 }}
      dragTransition={{ bounceStiffness: 400, bounceDamping: 40 }}
      style={{ position: 'relative', zIndex: isChildDragging ? 1000 : undefined }}
      className="bg-white rounded-lg border border-slate-200 overflow-visible transition-shadow duration-200"
      whileDrag={{
        scale: 1.02,
        boxShadow: '0 4px 16px -2px rgba(0,0,0,0.08)',
        zIndex: 1000,
      }}
    >
      <div className="p-4 border-b border-slate-100 flex items-center gap-2 flex-nowrap">
        <div
          className="min-w-[2rem] w-8 flex-shrink-0 flex items-center justify-center min-h-[28px] cursor-grab active:cursor-grabbing select-none"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => controls.start(e)}
          onMouseEnter={() => setHoverCategoryHandle({ ci: realCi, side: 'left' })}
          onMouseLeave={() => setHoverCategoryHandle(null)}
          title="拖动调整大类顺序"
        >
          <span
            className={`select-none touch-none transition-opacity ${hoverCategoryHandle?.ci === realCi && hoverCategoryHandle?.side === 'left' ? 'opacity-100 text-slate-500' : 'opacity-0 text-slate-400'}`}
            aria-hidden
          >
            ⋮⋮
          </span>
        </div>
        <input
          type="text"
          value={cat.name}
          onChange={(e) => updateCategory(realCi, { name: e.target.value })}
          className="font-medium text-slate-800 bg-transparent border border-transparent hover:border-slate-300 rounded px-2 py-1 flex-1 min-w-0"
          placeholder="类型名称"
        />
        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" onClick={() => setPresetModal({ categoryIndex: realCi, itemIndex: null })} className="text-sm text-slate-600 hover:text-slate-800 whitespace-nowrap">
            管理预设
          </button>
          <button type="button" onClick={() => removeCategory(realCi)} className="text-sm text-red-600 hover:text-red-700 whitespace-nowrap">
            删除类型
          </button>
        </div>
        <div
          className="min-w-[2rem] w-8 flex-shrink-0 flex items-center justify-center min-h-[28px] cursor-grab active:cursor-grabbing select-none"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => controls.start(e)}
          onMouseEnter={() => setHoverCategoryHandle({ ci: realCi, side: 'right' })}
          onMouseLeave={() => setHoverCategoryHandle(null)}
          title="拖动调整大类顺序"
        >
          <span
            className={`select-none touch-none transition-opacity ${hoverCategoryHandle?.ci === realCi && hoverCategoryHandle?.side === 'right' ? 'opacity-100 text-slate-500' : 'opacity-0 text-slate-400'}`}
            aria-hidden
          >
            ⋮⋮
          </span>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div ref={listRef} className="min-h-0">
          <Reorder.Group axis="y" values={cat.items} onReorder={(newOrder) => setCategoryItems(realCi, newOrder)} as="div" className="space-y-3">
            {cat.items.map((item, itemIndex) => (
              <SubReminderRow
                key={item.id}
                item={item}
                categoryIndex={realCi}
                itemIndex={itemIndex}
                categoryId={cat.id}
                countdowns={countdowns}
                updateItem={updateItem}
                removeItem={removeItem}
                getPresets={getPresets}
                applyPresetToItem={applyPresetToItem}
                presetDropdown={presetDropdown}
                setPresetDropdown={setPresetDropdown}
                repeatDropdown={repeatDropdown}
                setRepeatDropdown={setRepeatDropdown}
                setPresetModal={setPresetModal}
                hoverItemHandle={hoverItemHandle}
                setHoverItemHandle={setHoverItemHandle}
                dragConstraintsRef={listRef}
                onDragStart={() => setIsChildDragging(true)}
                onDragEnd={() => setIsChildDragging(false)}
              />
            ))}
          </Reorder.Group>
        </div>
        {addItemForCategory === realCi ? (
          <div className="flex gap-2 p-2 bg-slate-100 rounded">
            <button type="button" onClick={() => addItem(realCi, 'fixed')} className="rounded border border-slate-300 px-3 py-1 text-sm">固定时间</button>
            <button type="button" onClick={() => addItem(realCi, 'interval')} className="rounded border border-slate-300 px-3 py-1 text-sm">间隔</button>
            <button type="button" onClick={() => setAddItemForCategory(null)} className="text-slate-500 text-sm">取消</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAddItemForCategory(realCi)} className="text-sm text-slate-600 hover:text-slate-800">
            + 添加子提醒
          </button>
        )}
      </div>
    </Reorder.Item>
  )
}

export function Settings() {
  const [settings, setSettingsState] = useState<AppSettings>(defaultSettings)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string>('')
  const [settingsPath, setSettingsPath] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [lastSaveClick, setLastSaveClick] = useState<string>('从未')
  const [presetModal, setPresetModal] = useState<{ categoryIndex: number; itemIndex: number | null } | null>(null)
  const [presetDropdown, setPresetDropdown] = useState<{ categoryIndex: number; itemIndex: number } | null>(null)
  const [repeatDropdown, setRepeatDropdown] = useState<{ categoryIndex: number; itemIndex: number } | null>(null)
  const [editingPresetIndex, setEditingPresetIndex] = useState<number | null>(null)
  const [editingPresetValue, setEditingPresetValue] = useState('')
  const [newPresetValue, setNewPresetValue] = useState('')
  const [addItemForCategory, setAddItemForCategory] = useState<number | null>(null)
  const [countdowns, setCountdowns] = useState<CountdownItem[]>([])
  const [hoverCategoryHandle, setHoverCategoryHandle] = useState<{ ci: number; side: 'left' | 'right' } | null>(null)
  const [hoverItemHandle, setHoverItemHandle] = useState<{ ci: number; ii: number; side: 'left' | 'right' } | null>(null)
  const listContainerRefsMap = useRef<Record<string, React.RefObject<HTMLDivElement | null>>>({})

  useEffect(() => {
    const api = getApi()
    if (!api) {
      console.warn('[WorkBreak] window.electronAPI 不存在。请用「启动开发环境.bat」打开应用窗口，不要用浏览器打开 localhost')
      setLoading(false)
      return
    }
    api.getSettings().then((s) => {
      setSettingsState(s)
      setLoading(false)
    }).catch((e) => {
      console.error('[WorkBreak] getSettings 失败', e)
      setLoading(false)
    })
    api.getSettingsFilePath().then(setSettingsPath).catch(() => setSettingsPath('(获取失败)'))
  }, [])

  useEffect(() => {
    const api = getApi()
    if (!api?.getReminderCountdowns) return
    const tick = () => api.getReminderCountdowns().then(setCountdowns).catch(() => setCountdowns([]))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [settings.reminderCategories])

  const setCategories = (next: ReminderCategory[]) => {
    setSettingsState((prev) => ({ ...prev, reminderCategories: next }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const updateCategory = (categoryIndex: number, patch: Partial<ReminderCategory>) => {
    const next = settings.reminderCategories.slice()
    next[categoryIndex] = { ...next[categoryIndex], ...patch }
    setCategories(next)
  }

  const updateItem = (categoryIndex: number, itemIndex: number, patch: Partial<SubReminder>) => {
    const next = settings.reminderCategories.slice()
    const cat = { ...next[categoryIndex], items: next[categoryIndex].items.slice() }
    cat.items[itemIndex] = { ...cat.items[itemIndex], ...patch } as SubReminder
    next[categoryIndex] = cat
    setCategories(next)
  }

  const addCategory = () => {
    const newCat: ReminderCategory = {
      id: genId(),
      name: '新类型',
      presets: [],
      items: [],
    }
    setCategories([...settings.reminderCategories, newCat])
  }

  const removeCategory = (categoryIndex: number) => {
    setCategories(settings.reminderCategories.filter((_, i) => i !== categoryIndex))
    if (presetModal?.categoryIndex === categoryIndex) setPresetModal(null)
    if (presetModal && presetModal.categoryIndex > categoryIndex) setPresetModal({ ...presetModal, categoryIndex: presetModal.categoryIndex - 1 })
    if (presetDropdown?.categoryIndex === categoryIndex) setPresetDropdown(null)
    if (presetDropdown && presetDropdown.categoryIndex > categoryIndex) setPresetDropdown({ ...presetDropdown, categoryIndex: presetDropdown.categoryIndex - 1 })
    if (repeatDropdown?.categoryIndex === categoryIndex) setRepeatDropdown(null)
    if (repeatDropdown && repeatDropdown.categoryIndex > categoryIndex) setRepeatDropdown({ ...repeatDropdown, categoryIndex: repeatDropdown.categoryIndex - 1 })
  }

  const moveCategory = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    const next = settings.reminderCategories.slice()
    const [removed] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, removed)
    setCategories(next)
    if (presetModal !== null) {
      const idx = presetModal.categoryIndex
      if (idx === fromIndex) setPresetModal({ ...presetModal, categoryIndex: toIndex })
      else if (fromIndex < idx && toIndex >= idx) setPresetModal({ ...presetModal, categoryIndex: idx - 1 })
      else if (fromIndex > idx && toIndex <= idx) setPresetModal({ ...presetModal, categoryIndex: idx + 1 })
    }
    if (presetDropdown !== null) {
      const idx = presetDropdown.categoryIndex
      if (idx === fromIndex) setPresetDropdown({ ...presetDropdown, categoryIndex: toIndex })
      else if (fromIndex < idx && toIndex >= idx) setPresetDropdown({ ...presetDropdown, categoryIndex: idx - 1 })
      else if (fromIndex > idx && toIndex <= idx) setPresetDropdown({ ...presetDropdown, categoryIndex: idx + 1 })
    }
    if (repeatDropdown !== null) {
      const idx = repeatDropdown.categoryIndex
      if (idx === fromIndex) setRepeatDropdown({ ...repeatDropdown, categoryIndex: toIndex })
      else if (fromIndex < idx && toIndex >= idx) setRepeatDropdown({ ...repeatDropdown, categoryIndex: idx - 1 })
      else if (fromIndex > idx && toIndex <= idx) setRepeatDropdown({ ...repeatDropdown, categoryIndex: idx + 1 })
    }
  }

  const moveItem = (categoryIndex: number, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    const next = settings.reminderCategories.slice()
    const cat = { ...next[categoryIndex], items: next[categoryIndex].items.slice() }
    const [removed] = cat.items.splice(fromIndex, 1)
    cat.items.splice(toIndex, 0, removed)
    next[categoryIndex] = cat
    setCategories(next)
    if (presetDropdown?.categoryIndex === categoryIndex) {
      if (presetDropdown.itemIndex === fromIndex) setPresetDropdown({ ...presetDropdown, itemIndex: toIndex })
      else if (fromIndex < presetDropdown.itemIndex && toIndex >= presetDropdown.itemIndex) setPresetDropdown({ ...presetDropdown, itemIndex: presetDropdown.itemIndex - 1 })
      else if (fromIndex > presetDropdown.itemIndex && toIndex <= presetDropdown.itemIndex) setPresetDropdown({ ...presetDropdown, itemIndex: presetDropdown.itemIndex + 1 })
    }
    if (repeatDropdown?.categoryIndex === categoryIndex) {
      if (repeatDropdown.itemIndex === fromIndex) setRepeatDropdown({ ...repeatDropdown, itemIndex: toIndex })
      else if (fromIndex < repeatDropdown.itemIndex && toIndex >= repeatDropdown.itemIndex) setRepeatDropdown({ ...repeatDropdown, itemIndex: repeatDropdown.itemIndex - 1 })
      else if (fromIndex > repeatDropdown.itemIndex && toIndex <= repeatDropdown.itemIndex) setRepeatDropdown({ ...repeatDropdown, itemIndex: repeatDropdown.itemIndex + 1 })
    }
  }

  /** 将子项从一个大类移动到另一个大类（可同大类，相当于 moveItem） */
  const moveItemToCategory = (fromCi: number, fromIi: number, toCi: number, toIndex: number) => {
    const next = settings.reminderCategories.slice()
    const fromCat = next[fromCi]
    if (!fromCat || fromIi < 0 || fromIi >= fromCat.items.length) return
    const [removed] = fromCat.items.splice(fromIi, 1)
    const toCat = next[toCi]
    if (!toCat) return
    const toItems = toCi === fromCi ? fromCat.items : toCat.items.slice()
    const insertAt = Math.max(0, Math.min(toIndex, toItems.length))
    toItems.splice(insertAt, 0, removed)
    if (toCi === fromCi) {
      next[fromCi] = { ...fromCat, items: toItems }
    } else {
      next[fromCi] = { ...fromCat, items: fromCat.items }
      next[toCi] = { ...toCat, items: toItems }
    }
    setCategories(next)
    if (presetDropdown) {
      if (presetDropdown.categoryIndex === fromCi && presetDropdown.itemIndex === fromIi) {
        setPresetDropdown(toCi === fromCi ? { ...presetDropdown, itemIndex: insertAt } : { categoryIndex: toCi, itemIndex: insertAt })
      } else if (presetDropdown.categoryIndex === fromCi && fromIi < presetDropdown.itemIndex) {
        setPresetDropdown({ ...presetDropdown, itemIndex: presetDropdown.itemIndex - 1 })
      } else if (presetDropdown.categoryIndex === toCi && insertAt <= presetDropdown.itemIndex) {
        setPresetDropdown({ ...presetDropdown, itemIndex: presetDropdown.itemIndex + 1 })
      }
    }
    if (repeatDropdown) {
      if (repeatDropdown.categoryIndex === fromCi && repeatDropdown.itemIndex === fromIi) {
        setRepeatDropdown(toCi === fromCi ? { ...repeatDropdown, itemIndex: insertAt } : { categoryIndex: toCi, itemIndex: insertAt })
      } else if (repeatDropdown.categoryIndex === fromCi && fromIi < repeatDropdown.itemIndex) {
        setRepeatDropdown({ ...repeatDropdown, itemIndex: repeatDropdown.itemIndex - 1 })
      } else if (repeatDropdown.categoryIndex === toCi && insertAt <= repeatDropdown.itemIndex) {
        setRepeatDropdown({ ...repeatDropdown, itemIndex: repeatDropdown.itemIndex + 1 })
      }
    }
    if (presetModal?.categoryIndex === fromCi && presetModal.itemIndex === fromIi) {
      setPresetModal(toCi === fromCi ? { ...presetModal, itemIndex: insertAt } : { categoryIndex: toCi, itemIndex: insertAt })
    } else if (presetModal?.categoryIndex === fromCi && fromIi < (presetModal.itemIndex ?? 0)) {
      setPresetModal({ ...presetModal, itemIndex: (presetModal.itemIndex ?? 0) - 1 })
    } else if (presetModal?.categoryIndex === toCi && insertAt <= (presetModal.itemIndex ?? 0)) {
      setPresetModal({ ...presetModal, itemIndex: (presetModal.itemIndex ?? 0) + 1 })
    }
  }

  const addItem = (categoryIndex: number, mode: 'fixed' | 'interval') => {
    const cat = settings.reminderCategories[categoryIndex]
    const newItem: SubReminder =
      mode === 'fixed'
        ? { id: genId(), mode: 'fixed', time: '12:00', content: '' }
        : { id: genId(), mode: 'interval', intervalHours: 0, intervalMinutes: 30, intervalSeconds: 0, content: '', repeatCount: null }
    const next = settings.reminderCategories.slice()
    next[categoryIndex] = { ...cat, items: [...cat.items, newItem] }
    setCategories(next)
    setAddItemForCategory(null)
  }

  const removeItem = (categoryIndex: number, itemIndex: number) => {
    const next = settings.reminderCategories.slice()
    const cat = { ...next[categoryIndex], items: next[categoryIndex].items.filter((_, i) => i !== itemIndex) }
    next[categoryIndex] = cat
    setCategories(next)
    if (presetDropdown?.categoryIndex === categoryIndex && presetDropdown.itemIndex === itemIndex) setPresetDropdown(null)
    if (presetDropdown?.categoryIndex === categoryIndex && presetDropdown.itemIndex > itemIndex) setPresetDropdown({ ...presetDropdown, itemIndex: presetDropdown.itemIndex - 1 })
    if (repeatDropdown?.categoryIndex === categoryIndex && repeatDropdown.itemIndex === itemIndex) setRepeatDropdown(null)
    if (repeatDropdown?.categoryIndex === categoryIndex && repeatDropdown.itemIndex > itemIndex) setRepeatDropdown({ ...repeatDropdown, itemIndex: repeatDropdown.itemIndex - 1 })
  }

  const setCategoryPresets = (categoryIndex: number, presets: string[]) => {
    updateCategory(categoryIndex, { presets })
  }

  const setCategoryItems = (categoryIndex: number, items: SubReminder[]) => {
    const next = settings.reminderCategories.slice()
    next[categoryIndex] = { ...next[categoryIndex], items }
    setCategories(next)
    setPresetDropdown(null)
    setRepeatDropdown(null)
  }

  const getPresets = (categoryIndex: number) => settings.reminderCategories[categoryIndex]?.presets ?? []
  const applyPresetToItem = (categoryIndex: number, itemIndex: number, text: string) => {
    updateItem(categoryIndex, itemIndex, { content: text })
    setPresetDropdown(null)
    if (presetModal) setPresetModal(null)
  }

  const addPreset = (categoryIndex: number) => {
    const v = newPresetValue.trim()
    if (!v) return
    setCategoryPresets(categoryIndex, [...getPresets(categoryIndex), v])
    setNewPresetValue('')
  }

  const deletePreset = (categoryIndex: number, index: number) => {
    setCategoryPresets(categoryIndex, getPresets(categoryIndex).filter((_, i) => i !== index))
    if (editingPresetIndex === index) setEditingPresetIndex(null)
    else if (editingPresetIndex != null && editingPresetIndex > index) setEditingPresetIndex(editingPresetIndex - 1)
  }

  const startEditPreset = (index: number) => {
    setEditingPresetIndex(index)
    setEditingPresetValue(getPresets(presetModal!.categoryIndex)[index] ?? '')
  }

  const saveEditPreset = (categoryIndex: number) => {
    if (editingPresetIndex == null) return
    const list = getPresets(categoryIndex).slice()
    list[editingPresetIndex] = editingPresetValue.trim() || list[editingPresetIndex]
    setCategoryPresets(categoryIndex, list)
    setEditingPresetIndex(null)
    setEditingPresetValue('')
  }

  const save = async () => {
    setLastSaveClick(new Date().toLocaleTimeString('zh-CN'))
    const api = getApi()
    if (!api) {
      setSaveError('未检测到 Electron API。请用「启动开发环境.bat」打开应用窗口。')
      setSaveStatus('error')
      return
    }
    setSaveStatus('saving')
    setSaveError('')
    try {
      const result = await api.setSettings(settings)
      if (result.success) {
        setSettingsState(result.data)
        setSaveStatus('ok')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveError(result.error)
        setSaveStatus('error')
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
      setSaveStatus('error')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <span className="text-slate-500">加载中…</span>
      </div>
    )
  }

  const isElectron = !!getApi()

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <h1 className="text-xl font-semibold">WorkBreak 设置</h1>
        <p className="text-sm text-slate-500 mt-0.5">可配置的多种提醒类型</p>
        {!isElectron && (
          <div className="mt-2 p-3 bg-amber-100 border border-amber-400 rounded text-amber-800 text-sm">
            <p className="font-medium">当前是浏览器页面，保存无效。</p>
            <p className="mt-1">请用「启动开发环境.bat」打开应用窗口后再保存。</p>
          </div>
        )}
        <div className="mt-3 p-3 bg-slate-100 rounded text-xs space-y-1">
          <p><strong>调试</strong> electronAPI: {isElectron ? '已连接' : '未连接'} | 上次保存: {lastSaveClick} | 状态: {saveStatus}</p>
          {settingsPath && <p>设置文件: {settingsPath}</p>}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <Reorder.Group axis="y" values={settings.reminderCategories} onReorder={(newOrder) => { setCategories(newOrder); setPresetModal(null); setPresetDropdown(null); setRepeatDropdown(null) }} as="div" className="space-y-6">
        {settings.reminderCategories.map((cat, realCi) => (
          <CategoryCard
            key={cat.id}
            cat={cat}
            realCi={realCi}
            updateCategory={updateCategory}
            removeCategory={removeCategory}
            setPresetModal={setPresetModal}
            addItemForCategory={addItemForCategory}
            setAddItemForCategory={setAddItemForCategory}
            addItem={addItem}
            listContainerRefsMap={listContainerRefsMap}
            setCategoryItems={setCategoryItems}
            updateItem={updateItem}
            removeItem={removeItem}
            getPresets={getPresets}
            applyPresetToItem={applyPresetToItem}
            presetDropdown={presetDropdown}
            setPresetDropdown={setPresetDropdown}
            repeatDropdown={repeatDropdown}
            setRepeatDropdown={setRepeatDropdown}
            hoverItemHandle={hoverItemHandle}
            setHoverItemHandle={setHoverItemHandle}
            hoverCategoryHandle={hoverCategoryHandle}
            setHoverCategoryHandle={setHoverCategoryHandle}
            countdowns={countdowns}
          />
        ))}
        </Reorder.Group>

        <button
          type="button"
          onClick={addCategory}
          className="w-full rounded-lg border-2 border-dashed border-slate-300 py-3 text-slate-600 hover:border-slate-400 hover:text-slate-700 text-sm"
        >
          + 新增提醒类型
        </button>

        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={save}
              disabled={saveStatus === 'saving'}
              className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
            >
              {saveStatus === 'saving' ? '保存中…' : '保存设置'}
            </button>
            {saveStatus === 'ok' && <span className="text-sm font-medium text-green-600">已保存</span>}
            {saveStatus === 'error' && <span className="text-sm font-medium text-red-600">保存失败</span>}
          </div>
          {saveError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">错误：{saveError}</p>}
          {settingsPath && <p className="text-xs text-slate-500">设置文件：<code className="bg-slate-100 px-1 rounded">{settingsPath}</code></p>}
        </div>
      </main>

      {presetModal !== null && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => { setPresetModal(null); setEditingPresetIndex(null); setNewPresetValue('') }}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-medium text-slate-800">预设 - {settings.reminderCategories[presetModal.categoryIndex]?.name ?? ''}</h3>
              <button type="button" className="text-slate-400 hover:text-slate-600 text-xl leading-none" onClick={() => { setPresetModal(null); setEditingPresetIndex(null); setNewPresetValue('') }}>×</button>
            </div>
            <div className="p-4 overflow-auto flex-1">
              <ul className="space-y-2">
                {getPresets(presetModal.categoryIndex).map((p, i) => (
                  <li key={i} className="flex items-center gap-2 flex-wrap">
                    {editingPresetIndex === i ? (
                      <>
                        <input
                          type="text"
                          value={editingPresetValue}
                          onChange={(e) => setEditingPresetValue(e.target.value)}
                          className="flex-1 min-w-0 rounded border border-slate-300 px-2 py-1 text-sm"
                          autoFocus
                        />
                        <button type="button" className="rounded bg-slate-700 text-white px-2 py-1 text-sm" onClick={() => saveEditPreset(presetModal.categoryIndex)}>保存</button>
                        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-sm" onClick={() => { setEditingPresetIndex(null); setEditingPresetValue('') }}>取消</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 min-w-0 text-sm truncate">{p || '(空)'}</span>
                        {presetModal.itemIndex !== null && (
                          <button type="button" className="text-green-600 hover:text-green-700 text-sm" onClick={() => applyPresetToItem(presetModal.categoryIndex, presetModal.itemIndex!, p)}>使用</button>
                        )}
                        <button type="button" className="text-slate-600 hover:text-slate-800 text-sm" onClick={() => startEditPreset(i)}>编辑</button>
                        <button type="button" className="text-red-600 hover:text-red-700 text-sm" onClick={() => deletePreset(presetModal.categoryIndex, i)}>删除</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={newPresetValue}
                  onChange={(e) => setNewPresetValue(e.target.value)}
                  placeholder="新增预设内容"
                  className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && addPreset(presetModal.categoryIndex)}
                />
                <button type="button" className="rounded bg-slate-700 text-white px-3 py-1.5 text-sm" onClick={() => addPreset(presetModal.categoryIndex)}>添加</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
