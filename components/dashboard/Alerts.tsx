import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const AlertsComponent = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open Alerts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {/* Critical alert */}
          <div className="flex items-start gap-3 px-2 py-1 border-l-4 border-red-500 rounded-lg bg-red-50/50">
            <div className="w-8 h-8 rounded-red-500 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v2m0 4h.01M8 12h.01M16 12h.01M12 16h.01M9 13l2 2 2-2m6 2a9 9 0 1 1-6.78-2.05m3.34 4a5 5 0 1 1-5.338-2.956M12 2v.01M12 22v.01" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">Temperature critical - Shipment #4</p>
              <p className="text-xs text-gray-500">2 hours ago</p>
            </div>
          </div>

          {/* Medium alert */}
          <div className="flex items-start gap-3 px-2 py-1 border-b border-gray-100 last:border-0">
            <div className="w-8 h-8 rounded-orange-500 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v2m0 4h.01M8 12h.01M16 12h.01M12 16h.01M9 13l2 2 2-2m6 2a9 9 0 1 1-6.78-2.05m3.34 4a5 5 0 1 1-5.338-2.956M12 2v.01M12 22v.01" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">Humidity violation - Shipment #4</p>
              <p className="text-xs text-gray-500">4 hours ago</p>
            </div>
          </div>

          {/* Low alert */}
          <div className="flex items-start gap-3 px-2 py-1 border-b border-gray-100 last:border-0">
            <div className="w-8 h-8 rounded-green-500 flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v2m0 4h.01M8 12h.01M16 12h.01M12 16h.01M9 13l2 2 2-2m6 2a9 9 0 1 1-6.78-2.05m3.34 4a5 5 0 1 1-5.338-2.956M12 2v.01M12 22v.01" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">Routine check - Shipment #2</p>
              <p className="text-xs text-gray-500">Yesterday</p>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">Total open: 3</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default AlertsComponent;