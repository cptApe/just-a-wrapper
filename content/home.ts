/** The words on the public home page. A fork rewrites this file to retell its product. */
export const home = {
  signInAction: 'Sign in',
  getStartedAction: 'Get started',
  repositoryAction: 'Open in GitHub',

  heading: 'Stop rebuilding the chat window',
  line: 'Chat, files, memory, skills and schedules are ready. Take them and work on what makes your AI good.',

  workspace: {
    notifications: 'Notifications',
    search: 'Search',
    recents: 'Recents',
    userName: 'Sam Rivera',
    activeTask: 'Weekly signups',
    otherTasks: [
      { title: 'Draft the launch post', status: 'running' },
      { title: 'Customer call notes', status: 'unread' },
    ],
    share: 'Share',
    ask: 'Put last week’s signups in a sheet and send it to me every Monday.',
    workSteps: ['Thinking…', 'Reading signups.csv', 'Writing signups-last-week.xlsx'],
    workedFor: 'Worked for 38 seconds',
    reply: 'Your sheet is ready. I’ll send a fresh copy to your inbox every Monday at 9.',
    fileName: 'signups-last-week.xlsx',
    fileKind: 'Spreadsheet',
    fileMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    taskPlaceholder: 'Message the agent…',
    homePlaceholder: 'Assign a task or ask anything',
    disclaimer: 'Agent can make mistakes. Check important info.',
    mode: 'Mode: Balanced',
  },

  takeIt: {
    heading: 'Here is the wrapper, take it',
    hostedTitle: 'Use it here',
    hostedLine: 'Sign in and buy credits as you go.',
    repositoryTitle: 'Run it yourself',
    repositoryLine: 'Use the repo with your own keys.',
    cloneComment: '# Get the code',
    setupComment: '# Add your keys, then start',
    setupCommands: ['pnpm install', 'pnpm run setup', 'pnpm dev'],
  },

  termsLink: 'Terms',
  privacyLink: 'Privacy',
} as const;
