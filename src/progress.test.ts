import { describe, expect, it } from 'vitest'
import { emptyWorkspace } from './model'
import type { ChecklistItem, Milestone, Objective, Phase, Task, Workspace } from './model'
import { deriveRoadmapProgress } from './progress'

const timestamp = '2026-11-23T00:00:00Z'
const base = (id: string) => ({ id, createdAt: timestamp, updatedAt: timestamp })

function phase(id: string, position: number): Phase {
  return { ...base(id), title: id, roadmapId: 'roadmap', description: '', position }
}

function objective(id: string, phaseId: string, parentId: string | null = null): Objective {
  return { ...base(id), title: id, phaseId, parentId, description: '', position: 0, completed: false }
}

function task(id: string, objectiveId: string | null, status: Task['status']): Task {
  return {
    ...base(id), title: id, roadmapId: 'roadmap', objectiveId, status, priority: 'none', inbox: false,
    completedAt: status === 'completed' ? timestamp : null, description: '', dueDate: null, plannedDate: null,
  }
}

function milestone(id: string, position: number, targetDate: string | null, done = false): Milestone {
  return {
    ...base(id), title: id, roadmapId: 'roadmap', phaseId: null, targetDate, position,
    completedAt: done ? timestamp : null,
  }
}

describe('roadmap progress', () => {
  it('counts required tasks once and ignores side objectives and archived tasks', () => {
    const workspace: Workspace = {
      ...emptyWorkspace(),
      phases: [phase('deliver', 1), phase('build', 0)],
      objectives: [
        objective('create', 'build'),
        objective('polish', 'build', 'create'),
        objective('ship', 'deliver'),
      ],
      tasks: [
        task('implementation', 'create', 'completed'),
        task('prototype', 'create', 'archived'),
        task('animation', 'polish', 'active'),
        task('release', 'ship', 'active'),
        task('planning', null, 'completed'),
        { ...task('unassigned', null, 'active'), roadmapId: null, inbox: true },
      ],
    }
    const progress = deriveRoadmapProgress(workspace, 'roadmap')
    expect(progress.requiredTasks).toEqual({ completed: 2, total: 3 })
    expect(progress.currentPhase?.id).toBe('deliver')
    expect(progress.phases.map((entry) => entry.status)).toEqual(['completed', 'active'])
    expect(progress.phases[0].mainObjectives[0].isComplete).toBe(true)
    expect(progress.phases[0].mainObjectives[0].sideObjectives[0].isComplete).toBe(false)
    expect(progress.isComplete).toBe(false)
  })

  it('uses objective checklists for objective completion and leaves task checklists outside task totals', () => {
    const item: ChecklistItem = {
      ...base('verify'), title: 'Verify', taskId: null, objectiveId: 'deliver', completed: false, position: 0,
    }
    const workspace: Workspace = {
      ...emptyWorkspace(),
      phases: [phase('final', 0)],
      objectives: [objective('deliver', 'final')],
      tasks: [task('package', 'deliver', 'completed')],
      checklistItems: [item, { ...item, id: 'task-check', objectiveId: null, taskId: 'package' }],
    }
    const progress = deriveRoadmapProgress(workspace, 'roadmap')
    expect(progress.requiredTasks).toEqual({ completed: 1, total: 1 })
    expect(progress.currentPhase?.id).toBe('final')
    expect(progress.phases[0].mainObjectives[0].total).toBe(2)
    expect(progress.isComplete).toBe(false)

    workspace.checklistItems = [{ ...item, completed: true }]
    expect(deriveRoadmapProgress(workspace, 'roadmap').isComplete).toBe(true)
  })

  it('supports explicit objective completion and keeps an empty phase open', () => {
    const workspace: Workspace = {
      ...emptyWorkspace(),
      phases: [phase('empty', 1), phase('prepared', 0)],
      objectives: [{ ...objective('walkthrough', 'prepared'), completed: true }],
    }
    const progress = deriveRoadmapProgress(workspace, 'roadmap')
    expect(progress.phases.map((entry) => entry.status)).toEqual(['completed', 'active'])
    expect(progress.currentPhase?.id).toBe('empty')
    expect(progress.isComplete).toBe(false)
    expect(deriveRoadmapProgress(emptyWorkspace(), 'roadmap').isComplete).toBe(false)
  })

  it('selects the earliest incomplete dated milestone and keeps completed ones visible', () => {
    const workspace: Workspace = {
      ...emptyWorkspace(),
      milestones: [
        milestone('later', 0, '2026-12-08'),
        milestone('undated', 1, null),
        milestone('draft', 2, '2026-11-20', true),
        milestone('review', 3, '2026-12-01'),
        milestone('proofread', 4, '2026-12-01'),
        { ...milestone('other roadmap', 0, '2026-11-19'), roadmapId: 'other' },
      ],
    }
    const progress = deriveRoadmapProgress(workspace, 'roadmap')
    expect(progress.nextMilestone?.id).toBe('review')
    expect(progress.completedMilestones.map((entry) => entry.id)).toEqual(['draft'])
    expect(progress.milestones).toHaveLength(5)
  })
})
