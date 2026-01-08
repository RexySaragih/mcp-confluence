import z from 'zod';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { PlanOutput } from '../types/index.js';

export const plannerInputSchema = z.object({
  content: z.string().describe('Ticket or PRD content to break down'),
  format: z.literal('text').optional(),
});

export const breakdownToPlanTool = {
  name: 'breakdown_to_plan',
  description: 'Turns Jira/Confluence content into actionable tasks',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Ticket or PRD content to break down' },
      format: { type: 'string', enum: ['markdown', 'text'] },
    },
  },
};

export async function handleBreakdownToPlan(args: unknown): Promise<{
  content: { type: 'text'; text: string }[];
}> {
  const { content } = plannerInputSchema.parse(args);
  const plan = generatePlan(content);
  const text = formatPlan(plan);
  return { content: [{ type: 'text', text }] };
}

function generatePlan(content: string): PlanOutput {
  const lines = content.split('\n').map((line) => line.trim());
  const bulletLines = lines.filter((line) => /^[-*]/.test(line)).map((line) => line.replace(/^[-*]\s?/, ''));
  const heading = lines.find((line) => line.length > 10) ?? '';

  const overview = heading.slice(0, 240);
  const requirements = bulletLines.slice(0, 10);
  const tasks = [
    'Review requirements with stakeholders and confirm scope.',
    'Identify data/API needs and confirm authentication and rate limits.',
    'Design implementation plan with milestones and owners.',
    'Implement and test feature end-to-end with automated coverage.',
    'Prepare rollout plan and documentation.',
  ];
  const acceptanceCriteria = requirements.length
    ? requirements.map((req) => `Validate: ${req}`)
    : ['Clear acceptance criteria need to be defined with the requester.'];

  return {
    overview,
    requirements,
    tasks,
    acceptanceCriteria,
  };
}

function formatPlan(plan: PlanOutput): string {
  const sections = [
    plan.overview ? `Overview:\n${plan.overview}` : undefined,
    plan.requirements?.length ? `Requirements:\n- ${plan.requirements.join('\n- ')}` : undefined,
    plan.tasks?.length ? `Technical Tasks:\n- ${plan.tasks.join('\n- ')}` : undefined,
    plan.acceptanceCriteria?.length
      ? `Acceptance Criteria:\n- ${plan.acceptanceCriteria.join('\n- ')}`
      : undefined,
  ];

  return sections.filter(Boolean).join('\n\n');
}

