export declare class DashboardService {
    static getSummary(businessId: string): Promise<{
        todaySales: number;
        todayOrdersCount: number;
        todayCollected: number;
        totalOutstanding: number;
        totalCollected: number;
        statusCounts: Record<string, number>;
        overdueCustomers: {
            id: any;
            name: any;
            phone: any;
            creditTermsDays: any;
            balance: number;
            oldestInvoiceDate: any;
        }[];
    }>;
}
