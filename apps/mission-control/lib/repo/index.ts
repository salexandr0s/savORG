/**
 * Repository Layer Exports
 *
 * Single entry point for all repository functionality.
 */

// Provider (main entry point)
export { getRepos, createRepos, resetRepos, useMockData, type Repos } from './provider'

// Individual repos (for type imports)
export type { WorkOrdersRepo } from './workOrders'
export type { OperationsRepo, CreateOperationInput } from './operations'
export type { AgentsRepo } from './agents'
export type { ApprovalsRepo, CreateApprovalInput } from './approvals'
export type { ActivitiesRepo, CreateActivityInput } from './activities'
export type { ReceiptsRepo, CreateReceiptInput } from './receipts'
export type { SearchRepo, SearchResult, SearchOptions, SearchScope } from './search'
export type { SkillsRepo, SkillFilters, CreateSkillInput, UpdateSkillInput, SkillWithContentDTO, DuplicateSkillTarget } from './skills'
export type { PluginsRepo, PluginFilters, InstallPluginInput, UpdatePluginInput, PluginResponseMeta } from './plugins'
export { PluginUnsupportedError } from './plugins'

// Types (DTOs for UI consumption)
export type {
  WorkOrderDTO,
  WorkOrderWithOpsDTO,
  WorkOrderFilters,
  OperationDTO,
  OperationSummaryDTO,
  OperationFilters,
  AgentDTO,
  AgentFilters,
  ApprovalDTO,
  ApprovalFilters,
  ActivityDTO,
  ActivityFilters,
  ReceiptDTO,
  ReceiptFilters,
  PaginationOptions,
  CronJobDTO,
  SkillDTO,
  SkillScope,
  SkillValidationResult,
  SkillValidationError,
  SkillValidationStatus,
  PluginDTO,
  PluginWithConfigDTO,
  PluginSourceType,
  PluginStatus,
  PluginDoctorResult,
  PluginDoctorCheck,
  PluginDoctorStatus,
  PluginConfigSchema,
  DashboardStatsDTO,
  GatewayStatusDTO,
  WorkspaceFileDTO,
} from './types'
