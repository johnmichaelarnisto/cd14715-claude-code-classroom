import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery
}));

import { CodeReviewOrchestrator } from '../src/orchestrator.js';
import { ReviewReportSchema } from '../src/types/report-types.js';
import {
  ErrorCodes,
  RateLimiter,
  ReviewError,
  withRetry,
  withTimeout
} from '../src/utils/index.js';

const validReport = {
  pullRequest: {
    owner: 'udacity',
    repo: 'cd14715-simple-todo-app',
    number: 1
  },
  fileReviews: [
    {
      file: 'src/app.js',
      codeQuality: {
        file: 'src/app.js',
        issues: [],
        overallScore: 90,
        summary: 'Code quality is good.'
      },
      testCoverage: {
        file: 'src/app.js',
        hasTests: true,
        testFiles: ['tests/app.test.js'],
        untestedPaths: [],
        coverageEstimate: 85,
        summary: 'Most important paths are tested.'
      },
      refactorings: {
        file: 'src/app.js',
        suggestions: [],
        summary: 'No major refactoring is required.'
      }
    }
  ],
  summary: {
    totalFiles: 1,
    overallScore: 90,
    criticalIssues: 0,
    highPriorityTests: 0,
    refactoringOpportunities: 0
  },
  recommendations: [
    {
      priority: 'low' as const,
      category: 'testing',
      description: 'Maintain the existing test coverage.',
      files: ['src/app.js']
    }
  ],
  metadata: {
    analyzedAt: '2026-01-01T00:00:00.000Z',
    duration: 100,
    agentVersions: {
      'code-quality-analyzer': '1.0.0',
      'test-coverage-analyzer': '1.0.0',
      'refactoring-suggester': '1.0.0'
    }
  }
};

async function* successfulQuery() {
  yield {
    type: 'result',
    subtype: 'success',
    structured_output: validReport
  };
}

describe('ReviewReportSchema', () => {
  it('accepts a valid review report', () => {
    const result = ReviewReportSchema.safeParse(validReport);

    expect(result.success).toBe(true);
  });

  it('rejects an invalid review report', () => {
    const invalidReport = {
      ...validReport,
      summary: {
        ...validReport.summary,
        totalFiles: 'one'
      }
    };

    const result = ReviewReportSchema.safeParse(invalidReport);

    expect(result.success).toBe(false);
  });
});

describe('Utility functions', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('withRetry returns after a later attempt succeeds', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValue('success');

    const resultPromise = withRetry(operation, 2, 100);

    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('withRetry throws RETRY_EXHAUSTED after all attempts fail', async () => {
    const operation = vi.fn().mockRejectedValue(
      new Error('Permanent failure')
    );

    await expect(
      withRetry(operation, 2, 0)
    ).rejects.toMatchObject({
      code: ErrorCodes.RETRY_EXHAUSTED
    });

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('withTimeout rejects when the operation exceeds its limit', async () => {
    vi.useFakeTimers();

    const operation = () =>
      new Promise<string>(() => {
        // Intentionally never resolves.
      });

    const resultPromise = withTimeout(
      operation,
      1000,
      'Agent exceeded timeout'
    );

    const expectation = expect(resultPromise).rejects.toMatchObject({
      code: ErrorCodes.AGENT_TIMEOUT,
      message: 'Agent exceeded timeout'
    });

    await vi.advanceTimersByTimeAsync(1000);
    await expectation;
  });
});

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks active requests and released tokens', async () => {
    const limiter = new RateLimiter({
      maxRequestsPerMinute: 5,
      maxTokensPerMinute: 5000,
      maxConcurrent: 2
    });

    await limiter.acquire(1000);

    expect(limiter.getStatus()).toMatchObject({
      activeRequests: 1,
      requestsInWindow: 1,
      tokensInWindow: 1000
    });

    limiter.release(800);

    expect(limiter.getStatus()).toMatchObject({
      activeRequests: 0,
      requestsInWindow: 1,
      tokensInWindow: 800
    });
  });

  it('allows requests again after the one-minute window expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const limiter = new RateLimiter({
      maxRequestsPerMinute: 1,
      maxTokensPerMinute: 5000,
      maxConcurrent: 1
    });

    await limiter.acquire(1000);
    limiter.release();

    expect(limiter.canProceed(1000)).toBe(false);

    vi.advanceTimersByTime(60001);

    expect(limiter.canProceed(1000)).toBe(true);
  });
});

describe('CodeReviewOrchestrator', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(() => successfulQuery());
  });

  it('configures Task, GitHub, ESLint, and project skills', async () => {
    const orchestrator = new CodeReviewOrchestrator();

    await orchestrator.reviewPullRequest(
      'udacity',
      'cd14715-simple-todo-app',
      1
    );

    expect(mockQuery).toHaveBeenCalledOnce();

    const queryConfiguration = mockQuery.mock.calls[0][0];

    expect(queryConfiguration.options.allowedTools).toEqual(
      expect.arrayContaining([
        'Task',
        'mcp__github__get_pull_request',
        'mcp__github__get_pull_request_files',
        'mcp__github__get_file_contents',
        'mcp__eslint__lint-files'
      ])
    );

    expect(queryConfiguration.options.settingSources).toEqual([
      'project'
    ]);

    expect(queryConfiguration.options.cwd).toBe(process.cwd());
  });

  it('registers all three specialized subagents', async () => {
    const orchestrator = new CodeReviewOrchestrator();

    await orchestrator.reviewPullRequest(
      'udacity',
      'cd14715-simple-todo-app',
      1
    );

    const queryConfiguration = mockQuery.mock.calls[0][0];

    expect(Object.keys(queryConfiguration.options.agents)).toEqual(
      expect.arrayContaining([
        'code-quality-analyzer',
        'test-coverage-analyzer',
        'refactoring-suggester'
      ])
    );
  });

  it('returns and validates the structured review report', async () => {
    const orchestrator = new CodeReviewOrchestrator();

    const report = await orchestrator.reviewPullRequest(
      'udacity',
      'cd14715-simple-todo-app',
      1
    );

    expect(report.pullRequest).toEqual({
      owner: 'udacity',
      repo: 'cd14715-simple-todo-app',
      number: 1
    });

    expect(report.fileReviews).toHaveLength(1);
    expect(report.summary.totalFiles).toBe(1);
    expect(ReviewReportSchema.safeParse(report).success).toBe(true);
  });

  it('rejects invalid pull request input', async () => {
    const orchestrator = new CodeReviewOrchestrator();

    await expect(
      orchestrator.reviewPullRequest('', 'repo', 1)
    ).rejects.toThrow('Repository owner is required');

    await expect(
      orchestrator.reviewPullRequest('owner', '', 1)
    ).rejects.toThrow('Repository name is required');

    await expect(
      orchestrator.reviewPullRequest('owner', 'repo', 0)
    ).rejects.toThrow(
      'Pull request number must be a positive integer'
    );
  });

  it('rejects an invalid structured report', async () => {
    async function* invalidQuery() {
      yield {
        type: 'result',
        subtype: 'success',
        structured_output: {
          invalid: true
        }
      };
    }

    mockQuery.mockImplementation(() => invalidQuery());

    const orchestrator = new CodeReviewOrchestrator();

    await expect(
      orchestrator.reviewPullRequest(
        'udacity',
        'cd14715-simple-todo-app',
        1
      )
    ).rejects.toThrow();
  });
});

describe.runIf(process.env.RUN_INTEGRATION === 'true')(
  'Integration',
  () => {
    it(
      'reviews udacity/cd14715-simple-todo-app PR #1',
      async () => {
        vi.doUnmock('@anthropic-ai/claude-agent-sdk');

        const { CodeReviewOrchestrator: RealOrchestrator } =
          await import('../src/orchestrator.js');

        const orchestrator = new RealOrchestrator();

        const report = await orchestrator.reviewPullRequest(
          'udacity',
          'cd14715-simple-todo-app',
          1
        );

        expect(report.pullRequest.owner).toBe('udacity');
        expect(report.pullRequest.repo).toBe(
          'cd14715-simple-todo-app'
        );
        expect(report.pullRequest.number).toBe(1);
        expect(report.fileReviews.length).toBeGreaterThan(0);
        expect(
          ReviewReportSchema.safeParse(report).success
        ).toBe(true);
      },
      120000
    );
  }
);