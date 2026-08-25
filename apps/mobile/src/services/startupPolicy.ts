export function canRunStartupNetworkTasks(pactAccepted: boolean | null): boolean {
  return pactAccepted === true;
}
