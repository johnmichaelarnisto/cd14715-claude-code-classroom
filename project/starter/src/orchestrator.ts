import { AgentDefinition, query } from '@anthropic-ai/claude-agent-sdk';

import {
  ReviewReport,
  ReviewReportJSONSchema,
  ReviewReportSchema
} from './types/report-types';

import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester
} from './agents';

import { buildOrchestratorPrompt } from './prompts';
import { mcpServersConfig } from './config/mcp.config';

const PROJECT_ROOT = process.cwd();

export interface OrchestratorOptions {
  model?: string;
  maxTurns?: number;
}

export class CodeReviewOrchestrator {
  private readonly model: string;
  private readonly maxTurns: number;
  private readonly agents: Record<string, AgentDefinition>;

  constructor(options: OrchestratorOptions = {}) {
    this.model =
      options.model ||
      process.env.ANTHROPIC_MODEL ||
      'claude-sonnet-4-5-20250929';

    this.maxTurns = options.maxTurns ?? 20;

    this.agents = {
      'code-quality-analyzer': codeQualityAnalyzer,
      'test-coverage-analyzer': testCoverageAnalyzer,
      'refactoring-suggester': refactoringSuggester
    };
  }

  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    if (!owner.trim()) {
      throw new Error('Repository owner is required');
    }

    if (!repo.trim()) {
      throw new Error('Repository name is required');
    }

    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error(
        'Pull request number must be a positive integer'
      );
    }

    const startedAt = Date.now();

    const prompt = buildOrchestratorPrompt(
      owner,
      repo,
      prNumber
    );

    for await (const message of query({
      prompt,
     options: {
  agents: this.agents,
  allowedTools: [
    'Task',
    'mcp__github__get_pull_request',
    'mcp__github__get_pull_request_files',
    'mcp__github__get_file_contents',
    'mcp__eslint__lint-files'
  ],
  mcpServers: mcpServersConfig,
  cwd: PROJECT_ROOT,
  settingSources: ['project'],
        model: this.model,
        maxTurns: this.maxTurns,
        outputFormat: {
          type: 'json_schema',
          schema: ReviewReportJSONSchema
        }
      }
    })) {
      if (
        message.type === 'result' &&
        message.subtype === 'success' &&
        message.structured_output
      ) {
        const report = ReviewReportSchema.parse(
          message.structured_output
        );

        return {
          ...report,
          metadata: {
            ...report.metadata,
            analyzedAt:
              report.metadata.analyzedAt ||
              new Date().toISOString(),
            duration:
              report.metadata.duration ||
              Date.now() - startedAt
          }
        };
      }

      if (
        message.type === 'result' &&
        message.subtype !== 'success'
      ) {
        throw new Error(
          `Code review failed: ${message.subtype}`
        );
      }
    }

    throw new Error(
      'The code review completed without a structured report'
    );
  }
}