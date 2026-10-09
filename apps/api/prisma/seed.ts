/**
 * Seed script for local development.
 *
 * Usage:
 *   cd apps/api && npm run db:seed
 *
 * Idempotent: drops and recreates the demo workspace. Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/crypto/passwords';
import {
  newMembershipId,
  newUserId,
  newWorkspaceId
} from '@syncpath/domain';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = 'demo@syncpath.local';
  const username = 'demo';
  const password = 'demo-pass-1234';

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      id: newUserId(),
      email,
      username,
      displayName: 'Demo User',
      passwordHash
    }
  });

  const slug = 'demo-workspace';
  await prisma.workspace.deleteMany({ where: { slug } });
  const workspace = await prisma.workspace.create({
    data: {
      id: newWorkspaceId(),
      name: 'Demo Workspace',
      slug,
      ownerId: user.id
    }
  });

  await prisma.membership.create({
    data: {
      id: newMembershipId(),
      workspaceId: workspace.id,
      userId: user.id,
      role: 'Owner'
    }
  });

  // eslint-disable-next-line no-console
  console.log(
    `Seeded demo user (username: ${username}, password: ${password}) ` +
      `and workspace "${workspace.name}" (slug: ${workspace.slug}).`
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
