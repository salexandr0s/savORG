'use client'

import type { WorkflowDetail } from '@/lib/http'
import { cn } from '@/lib/utils'

interface WorkflowVisualizationProps {
  workflow: WorkflowDetail['workflow']
}

export function WorkflowVisualization({ workflow }: WorkflowVisualizationProps) {
  return (
    <div className="space-y-3">
      {workflow.stages.map((stage, index) => {
        const isLoop = stage.type === 'loop'
        const verifyStage = stage.loop?.verifyStageRef

        return (
          <div key={stage.ref}>
            <div className={cn(
              'rounded-[var(--radius-md)] border border-bd-0 bg-bg-2 p-3',
              isLoop && 'border-status-info/40'
            )}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-fg-0">
                    {index + 1}. {stage.ref}
                  </div>
                  <div className="text-xs text-fg-2">Agent: {stage.agent}</div>
                </div>

                <div className="flex items-center gap-1.5 text-xs">
                  {stage.optional && (
                    <span className="px-2 py-0.5 rounded bg-bg-3 text-fg-2">Optional</span>
                  )}
                  {stage.canVeto && (
                    <span className="px-2 py-0.5 rounded bg-status-danger/15 text-status-danger">Veto</span>
                  )}
                  {isLoop && (
                    <span className="px-2 py-0.5 rounded bg-status-info/15 text-status-info">Loop</span>
                  )}
                </div>
              </div>

              {isLoop && (
                <div className="mt-2 text-xs text-fg-2 space-y-1">
                  <div>Loop: {stage.loop?.over} / {stage.loop?.completion}</div>
                  {verifyStage && <div>Verify each via: {verifyStage}</div>}
                  {typeof stage.loop?.maxStories === 'number' && <div>Max stories: {stage.loop.maxStories}</div>}
                </div>
              )}

              {stage.loopTarget && (
                <div className="mt-2 text-xs text-fg-2">
                  On rejection loop back to: <span className="text-fg-1">{stage.loopTarget}</span>
                </div>
              )}
            </div>

            {index < workflow.stages.length - 1 && (
              <div className="flex justify-center py-1">
                <span className="text-fg-3 text-xs">↓</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
