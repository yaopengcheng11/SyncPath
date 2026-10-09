import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [userCount, workspaceCount, projectCount, entryCount, sessionCount, projectMemberCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.workspace.count(),
      prisma.project.count(),
      prisma.progressEntry.count(),
      prisma.session.count(),
      prisma.projectMember.count()
    ]);

  console.log(
    JSON.stringify(
      {
        users: userCount,
        workspaces: workspaceCount,
        projects: projectCount,
        progressEntries: entryCount,
        sessions: sessionCount,
        projectMembers: projectMemberCount
      },
      null,
      2
    )
  );

  const users = await prisma.user.findMany({ select: { id: true, username: true, email: true } });
  console.log('users:', JSON.stringify(users, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
