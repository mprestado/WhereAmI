import { Archive, ChevronDown, CircleDot, Ellipsis, Inbox, ListTodo, PanelTop, Plus, Search, Settings2, SlidersHorizontal } from 'lucide-react'
import type { Roadmap } from './model'
import { syncLabels, type SyncState } from './Settings'
import { taskTitles } from './Tasks'
import type { TaskView } from './taskViews'

const popoverId = 'workspace-actions'
const taskViews: TaskView[] = ['inbox', 'today', 'upcoming', 'active', 'completed', 'archived']

export function closeWorkspaceMenu() {
  const menu = document.getElementById(popoverId)
  if (menu?.matches(':popover-open')) menu.hidePopover()
  menu?.querySelectorAll('details[open]').forEach(details => details.removeAttribute('open'))
}

interface Props {
  goals: Roadmap[]
  archivedGoals: Roadmap[]
  activeGoal?: Roadmap
  session: { id: string; email: string } | null
  syncState: SyncState
  pending: number
  inboxCount: number
  onSelectGoal: (id: string) => void
  onCreateGoal: () => void
  onGoalSettings: (id: string) => void
  onOpenOverlay?: () => void
  onTasks: (view: TaskView) => void
  onSettings: () => void
  onCapture: () => void
  onSearch: () => void
}

export default function WorkspaceMenu(props: Props) {
  const { goals, archivedGoals, activeGoal, session, syncState, inboxCount, pending, onOpenOverlay } = props
  const hasSyncNotice = syncState === 'failed' || syncState === 'offline' || syncState === 'saving'

  function run(action: () => void) {
    closeWorkspaceMenu()
    action()
  }

  return <>
    <button type="button" className="workspace-menu-trigger" aria-label="Workspace menu"
      title={hasSyncNotice ? syncLabels[syncState] : 'Workspace menu'} popoverTarget={popoverId}>
      <Ellipsis size={22} />
      {hasSyncNotice && <span className={'workspace-menu-dot is-' + syncState} aria-hidden="true" />}
    </button>
    <nav popover="auto" id={popoverId} className="workspace-menu" aria-label="Workspace options">
      {goals.length > 1 && <details>
        <summary><CircleDot size={17} /> Switch goal or list <ChevronDown size={15} className="workspace-menu-end" /></summary>
        <div className="workspace-submenu">{goals.map(goal => <button key={goal.id} type="button"
          aria-current={goal.id === activeGoal?.id ? 'page' : undefined}
          onClick={() => run(() => props.onSelectGoal(goal.id))}>{goal.title}</button>)}</div>
      </details>}
      <button type="button" onClick={() => run(props.onCreateGoal)}><Plus size={17} /> Add goal or task list</button>
      {activeGoal && <button type="button" onClick={() => run(() => props.onGoalSettings(activeGoal.id))}><SlidersHorizontal size={17} /> Goal settings</button>}
      {archivedGoals.length > 0 && <details>
        <summary><Archive size={17} /> Archived goals and lists <ChevronDown size={15} className="workspace-menu-end" /></summary>
        <div className="workspace-submenu">{archivedGoals.map(goal => <button key={goal.id} type="button"
          onClick={() => run(() => props.onGoalSettings(goal.id))}>{goal.title}</button>)}</div>
      </details>}
      <details>
        <summary><ListTodo size={17} /> Tasks <ChevronDown size={15} className="workspace-menu-end" /></summary>
        <div className="workspace-submenu">{taskViews.map(view => <button key={view} type="button" onClick={() => run(() => props.onTasks(view))}>
          {taskTitles[view]}{view === 'inbox' && inboxCount > 0 && <span className="workspace-menu-end" aria-hidden="true">{inboxCount}</span>}
        </button>)}</div>
      </details>
      <button type="button" onClick={() => run(props.onCapture)}><Inbox size={17} /> Quick capture</button>
      <button type="button" onClick={() => run(props.onSearch)}><Search size={17} /> Search workspace</button>
      {onOpenOverlay && <button type="button" aria-keyshortcuts="Control+Shift+." title="Ctrl+Shift+." onClick={() => run(onOpenOverlay)}>
        <PanelTop size={17} /> Task overlay
      </button>}
      <hr />
      <button type="button" onClick={() => run(props.onSettings)}><Settings2 size={17} /> Account and settings</button>
      {(session || hasSyncNotice) && <p className="workspace-menu-status">{syncLabels[syncState]}{pending > 0 && ' · ' + pending + ' pending'}</p>}
    </nav>
  </>
}
