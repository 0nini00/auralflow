export class LatestRequestGate {
  private latestId = 0;

  begin(): number {
    this.latestId += 1;
    return this.latestId;
  }

  invalidate(): void {
    this.latestId += 1;
  }

  isCurrent(id: number): boolean {
    return id === this.latestId;
  }
}
