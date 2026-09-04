export interface Repository {
  id: number
  name: string
  gitUrl: string
  credentialId?: number
  defaultBranch: string
  dockerfilePath: string
  buildContext: string
  scanStatus: string
  scanMessage: string
}

export interface Registry {
  id: number
  name: string
  url: string
  username: string
  passwordSet: boolean
  credentialId?: number
  namespace: string
  insecureSkipTls: boolean
  isDefault: boolean
  lastTestStatus?: string
  lastTestAt?: string
  lastDeploy?: {
    runId: number
    number: number
    imageTag: string
    finishedAt?: string
  } | null
}

export interface Credential {
  id: number
  name: string
  type: string
  username: string
  secretSet: boolean
}

export interface DeployTarget {
  id: number
  name: string
  type: string
  defaultNamespace: string
  kubeconfigSet: boolean
  isDefault: boolean
  lastTestStatus?: string
  lastTestAt?: string
  lastDeploy?: {
    runId: number
    number: number
    imageTag: string
    finishedAt?: string
  } | null
}

export interface DeployConfig {
  targetId: number
  kind?: string
  name?: string
  namespace?: string
  container?: string
  approval?: boolean
}

export interface PipelineConfig {
  imageName?: string
  tagTemplate?: string
  registryId?: number
  dockerfilePath?: string
  buildContext?: string
  buildArgs?: Record<string, string>
  platform?: string
  deploy?: DeployConfig
}

export interface Variable {
  id: number
  key: string
  secret: boolean
  description: string
  valueSet: boolean
}

export interface User {
  id: number
  username: string
  role: string
}

export interface Pipeline {
  id: number
  repoId: number
  config: PipelineConfig
  branchRules: { branch: string; overrides?: Record<string, unknown> }[]
  notify: Record<string, unknown>
  webhookUrl: string
  group?: string
  schedule?: string
  lastRun?: {
    runId: number
    number: number
    status: string
    triggerType: string
    ref: string
    commitShort: string
    imageTag: string
    startedAt?: string
    finishedAt?: string
  } | null
}

export interface Step {
  name: string
  status: string
  startedAt?: string
  finishedAt?: string
}

export interface Run {
  id: number
  pipelineId: number
  number: number
  triggerType: string
  ref: string
  commit: string
  commitShort: string
  status: string
  imageTag: string
  error: string
  approvalRequired: boolean
  approvedBy: string
  rejectedReason: string
  steps: Step[]
  startedAt?: string
  finishedAt?: string
}

export interface NotifyChannel {
  id: number
  name: string
  type: string
  config: Record<string, string>
}
