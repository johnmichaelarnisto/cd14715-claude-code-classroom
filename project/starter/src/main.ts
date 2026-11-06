import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import { CodeReviewOrchestrator } from './orchestrator';
import { ReportGenerator } from './utils/report-generator';

dotenv.config();

async function main(): Promise<void> {
  const [owner, repo, prStr] = process.argv.slice(2);

  if (!owner || !repo || !prStr) {
    console.error(
      'Usage: npm run dev -- <owner> <repo> <pr-number>'
    );
    process.exitCode = 1;
    return;
  }

  const prNumber = Number(prStr);

  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error('Error: PR number must be a positive integer.');
    process.exitCode = 1;
    return;
  }

  const usingAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  const usingBedrock = Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION
  );

  if (!usingAnthropic && !usingBedrock) {
    console.error(
      'Error: No authentication configured.\n' +
      'Provide ANTHROPIC_API_KEY or AWS Bedrock credentials.'
    );
    process.exitCode = 1;
    return;
  }

  if (usingBedrock) {
    console.log('Using AWS Bedrock authentication');
  } else {
    console.log('Using Anthropic API authentication');
  }

  if (!process.env.ANTHROPIC_MODEL) {
    console.error(
      'Error: ANTHROPIC_MODEL environment variable is required.'
    );
    process.exitCode = 1;
    return;
  }

  try {
    console.log(`Reviewing ${owner}/${repo} PR #${prNumber}...`);

    const orchestrator = new CodeReviewOrchestrator();

    const report = await orchestrator.reviewPullRequest(
      owner,
      repo,
      prNumber
    );

    const generator = new ReportGenerator();

    const reportsDir = path.resolve('reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const baseName = `${owner}-${repo}-pr-${prNumber}`;

    fs.writeFileSync(
      path.join(reportsDir, `${baseName}.md`),
      generator.generateMarkdownReport(report)
    );

    fs.writeFileSync(
      path.join(reportsDir, `${baseName}.html`),
      generator.generateHTMLReport(report)
    );

    fs.writeFileSync(
      path.join(reportsDir, `${baseName}.json`),
      generator.generateJSONReport(report)
    );

    console.log('Code review completed successfully.');
    console.log(`Reports saved to: ${reportsDir}`);
  } catch (error) {
    console.error(
      'Code review failed:',
      error instanceof Error ? error.message : error
    );

    process.exitCode = 1;
  }
}

void main();