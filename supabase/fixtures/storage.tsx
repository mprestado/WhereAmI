import { createRoot } from 'react-dom/client'
import { localDate, put, newTask, recordBase, touch } from '../../src/model'
import { setCountTarget } from '../../src/counting'
import { useWorkspace } from '../../src/storage'

function Harness() {
  const workspace = useWorkspace()
  Object.assign(window, {
    storageHarness: {
      ...workspace,
      addTask: (title: string) => workspace.commit([put('tasks', newTask(title))]),
      addTrackedTask: (title: string, target: number) =>
        workspace.commit([put('tasks', setCountTarget(newTask(title), target))]),
      addGoalWithOptionalWork: () => {
        const goal = recordBase()
        const phase = recordBase()
        const objective = recordBase()
        return workspace.commit([
          put('roadmaps', {
            ...goal, title: 'Unordered list', purpose: '', startingPoint: '', outcome: '',
            startDate: localDate(), targetDate: null, archived: false, presentation: 'list',
          }),
          put('phases', { ...phase, title: 'Default group', roadmapId: goal.id, description: '', position: 0 }),
          put('objectives', {
            ...objective, title: 'Optional objective', phaseId: phase.id, parentId: null,
            description: '', position: 0, goalPosition: 0, completed: false, optional: true,
          }),
          put('tasks', newTask('Ordered sub-objective', {
            roadmapId: goal.id, objectiveId: objective.id, inbox: false, optional: true, position: 1,
          })),
          put('checklistItems', {
            ...recordBase(), title: 'Optional check', taskId: null, objectiveId: objective.id,
            completed: false, position: 0, optional: true,
          }),
        ])
      },
      renameTask: (id: string, title: string) => {
        const task = workspace.data.tasks.find(task => task.id === id)
        if (!task) throw new Error('Could not find task in the client.')
        return workspace.commit([put('tasks', touch({ ...task, title }))])
      },
    },
  })
  return <p>{workspace.syncState}</p>
}

createRoot(document.getElementById('test')!).render(<Harness />)
