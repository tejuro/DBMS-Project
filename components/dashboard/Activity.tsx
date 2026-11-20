import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const ActivityComponent = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Shipment Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {/* Activity item 1 */}
          <div className="flex items-start gap-3 px-2 py-1 border-b border-gray-100 last:border-0">
            <div className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">Shipment #5 delivered successfully</p>
              <p className="text-xs text-gray-500">2 hours ago</p>
            </div>
          </div>

          {/* Activity item 2 */}
          <div className="flex items-start gap-3 px-2 py-1 border-b border-gray-100 last:border-0">
            <div className="w-8 h-8 rounded bg-orange-100 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">Shipment #3 delayed due to weather</p>
              <p className="text-xs text-gray-500">Yesterday</p>
            </div>
          </div>

          {/* Activity item 3 */}
          <div className="flex items-start gap-3 px-2 py-1 border-b border-gray-100 last:border-0">
            <div className="w-8 h-8 rounded bg-green-100 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">Shipment #1 completed</p>
              <p className="text-xs text-gray-500">3 days ago</p>
            </div>
          </div>

          {/* Activity item 4 */}
          <div className="flex items-start gap-3 px-2 py-1 border-b border-gray-100 last:border-0">
            <div className="w-8 h-8 rounded bg-red-100 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v2m0 4vm2a6 6 0 1 0-2.958 7.765L3 18l.098-.02m17.238 3.343L21 9" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">Critical alert acknowledged - Shipment #4</p>
              <p className="text-xs text-gray-500">1 hour ago</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ActivityComponent;