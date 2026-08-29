/**
 * OpenHeal Qodo CLI & PR-Agent Scorecard Engine TypeScript Definitions
 * 
 * Provides type contracts for:
 * 1. Qodo Cover (`qodo-cover`) test generation & coverage analysis
 * 2. Qodo PR-Agent code quality and security scoring engine ($0.35 Q_{code} + 0.35 S_{security} + 0.20 C_{coverage} + 0.10 P_{perf}$)
 * 3. Security vulnerability findings (CWE / CVE AST taint analysis)
 * 4. Inline review comments and markdown summaries
 */

export interface QodoCoverOptions {
  sourceFilePath: string;
  testFilePath?: string;
  testCommand: string;
  desiredCoverage?: number;
  maxIterations?: number;
  workingDirectory?: string;
  coverageType?: 'cobertura' | 'lcov' | 'json' | 'text';
  outputDir?: string;
  language?: 'python' | 'typescript' | 'javascript' | 'go' | 'rust' | string;
  customPrompt?: string;
  patchDiff?: string;
  healedSourceCode?: string;
  originalSourceCode?: string;
  sandboxRunner?: (command: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export type QodoTestType = 'regression' | 'edge_case' | 'boundary' | 'error_handling';

export interface QodoGeneratedTestCase {
  testName: string;
  testCode: string;
  description: string;
  targetFunction: string;
  testType: QodoTestType;
  passed: boolean;
  assertionCount?: number;
  failureMessage?: string;
  executionDurationMs?: number;
}

export interface QodoCoverResult {
  success: boolean;
  baselineCoverage: number;
  finalCoverage: number;
  coverageDelta: number;
  generatedTests: QodoGeneratedTestCase[];
  testOutput: string;
  modifiedTestFilePath: string;
  executionDurationMs: number;
  rawCliOutput?: string;
  iterationsRun?: number;
}

export interface QodoScorecardMetric {
  name: string;
  score: number; // 0 - 100
  weight: number; // 0.0 - 1.0
  status: 'passed' | 'warning' | 'failed';
  details: string;
}

export type QodoSecuritySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface QodoSecurityFinding {
  severity: QodoSecuritySeverity;
  title: string;
  description: string;
  cveOrCwe?: string;
  lineRange?: { start: number; end: number };
  mitigated: boolean;
  remediation?: string;
  vulnerabilityType?: string;
}

export type QodoReviewCommentType = 'praise' | 'suggestion' | 'nitpick' | 'security_note';

export interface QodoReviewComment {
  file: string;
  lineNumber: number;
  comment: string;
  type: QodoReviewCommentType;
}

export interface QodoScorecardBreakdown {
  ruleViolations: string[];
  securityRisks: string[];
  complexityIndex: number;
  synthesizedTests: number;
}

export type QodoGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
export type QodoVerdict = 'APPROVED_FOR_PR' | 'REQUIRES_MANUAL_REVIEW' | 'REJECTED';

/**
 * Full Qodo Scorecard Report structure.
 * Compatible with both QodoScorecardReport and QodoScorecardResult.
 */
export interface QodoScorecardReport {
  overallScore: number; // 0 - 100
  qualityScore: number; // 0 - 100
  securityScore: number; // 0 - 100
  coverageScore: number; // 0 - 100
  performanceScore: number; // 0 - 100
  grade: QodoGrade;
  verdict: QodoVerdict;
  passed: boolean;
  metrics: {
    codeQuality: QodoScorecardMetric;
    security: QodoScorecardMetric;
    testCoverage: QodoScorecardMetric;
    performance: QodoScorecardMetric;
  };
  breakdown: QodoScorecardBreakdown;
  keyFindings: string[];
  securityAudit: {
    passed: boolean;
    findings: QodoSecurityFinding[];
  };
  reviewComments: QodoReviewComment[];
  markdownSummary: string;
}

/**
 * Interface contract matching PROJECT.md interface 3: TrueForge ↔ Qodo Scorecard Engine
 */
export interface QodoScorecardResult {
  overallScore: number; // 0 - 100
  qualityScore: number; // 0 - 100
  securityScore: number; // 0 - 100
  coverageScore: number; // 0 - 100
  performanceScore: number; // 0 - 100
  breakdown: {
    ruleViolations: string[];
    securityRisks: string[];
    complexityIndex: number;
    synthesizedTests: number;
  };
  passed: boolean;
  grade?: QodoGrade;
  verdict?: QodoVerdict;
  metrics?: {
    codeQuality: QodoScorecardMetric;
    security: QodoScorecardMetric;
    testCoverage: QodoScorecardMetric;
    performance: QodoScorecardMetric;
  };
  keyFindings?: string[];
  securityAudit?: {
    passed: boolean;
    findings: QodoSecurityFinding[];
  };
  reviewComments?: QodoReviewComment[];
  markdownSummary?: string;
}

export interface ScorecardInput {
  originalCode?: string;
  healedCode?: string;
  diff?: string;
  filePath?: string;
  language?: 'python' | 'typescript' | 'javascript' | 'go' | 'rust' | string;
  testResults?: {
    passed: boolean;
    exitCode?: number;
    coveragePercent?: number;
    testOutput?: string;
  };
  generatedTestsCount?: number;
  diagnosticFinding?: string;
}

export interface ExtractedASTFunction {
  name: string;
  params: string[];
  returnType?: string;
  body: string;
  startLine: number;
  endLine: number;
  isAsync?: boolean;
  isExported?: boolean;
}
