import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const DashboardKPI = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Key Performance Indicators</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Shipments Card */}
          <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-teal-500">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Shipments</p>
                <p className="text-2xl font-bold text-navy-900">0</p>
              </div>
              <div className="w-10 h-10 rounded bg-teal-100 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 4h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Active Shipments Card */}
          <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-green-500">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">Active Shipments</p>
                <p className="text-2xl font-bold text-green-600">0</p>
              </div>
              <div className="w-10 h-10 rounded bg-green-100 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3v18M3 12h18M3 6h18" />
                </svg>
              </div>
            </div>
          </div>

          {/* Delivered Shipments Card */}
          <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-blue-500">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">Delivered</p>
                <p className="text-2xl font-bold text-blue-600">0</p>
              </div>
              <div className="w-10 h-10 rounded bg-blue-100 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22h10v-2h-10v-2h-2v2H5v2H3v-2zM5 12h14l2-8H5l2 8z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Delayed Shipments Card */}
          <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-orange-500">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">Delayed</p>
                <p className="text-2xl font-bold text-orange-600">0</p>
              </div>
              <div className="w-10 h-10 rounded bg-orange-100 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DashboardKPI;