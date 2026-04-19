import TeamPerformancePanel from "@/components/TeamPerformancePanel";

const SalesLeaderboard = () => (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-bold">Sales Leaderboard</h1>
      <p className="text-sm text-muted-foreground">Per-salesperson performance across all leads</p>
    </div>
    <TeamPerformancePanel />
  </div>
);

export default SalesLeaderboard;
