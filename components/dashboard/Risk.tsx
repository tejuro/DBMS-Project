import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const RiskComponent = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Shipment Risk Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* High risk card */}
          <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-red-500">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">High Risk Shipments</p>
                <p className="text-2xl font-bold text-red-600">2</p>
              </div>
              <div className="w-12 h-12 rounded-red-500 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 4" />
                </svg>
              </div>
            </div>
          </div>

          {/* Medium risk card */}
          <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-orange-500">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">Medium Risk</p>
                <p className="text-2xl font-bold text-orange-600">3</p>
              </div>
              <div className="w-12 h-12 rounded-orange-500 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 4" />
                </svg>
              </div>
            </div>
          </div>

          {/* Low risk card */}
          <div className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-green-500">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">Low Risk</p>
                <p className="text-2xl font-bold text-green-600">5</p>
              </div>
              <div className="w-12 h-12 rounded-green-500 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 4" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default RiskComponent;