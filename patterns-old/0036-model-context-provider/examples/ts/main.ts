// main.ts

// Interface for User Preferences Context
interface UserPreferences {
    [key: string]: any; // Represents various user preferences
}

// Class to manage user preferences context
class UserPreferenceContext {
    private userId: string;
    private preferences: UserPreferences;

    constructor(userId: string) {
        this.userId = userId;
        this.preferences = this.loadPreferences();
    }

    // Method to load initial preferences (mock data for this example)
    private loadPreferences(): UserPreferences {
        return { theme: 'light', currency: 'USD' }; // Default preferences
    }

    // Method to update user preferences and notify the recommendation engine
    public updatePreferences(newPreferences: UserPreferences): void {
        this.preferences = { ...this.preferences, ...newPreferences };
        this.notifyRecommendationEngine();
    }

    // Mock notification to the recommendation engine
    private notifyRecommendationEngine(): void {
        console.log(`User preferences updated for user ${this.userId}:`, this.preferences);
    }

    // Getter for current preferences
    public getPreferences(): UserPreferences {
        return this.preferences;
    }
}

// Class to manage browsing history context
class BrowsingHistoryContext {
    private userId: string;
    private history: string[];

    constructor(userId: string) {
        this.userId = userId;
        this.history = [];
    }

    // Method to add an item to browsing history and notify the recommendation engine
    public addToHistory(item: string): void {
        this.history.push(item);
        this.notifyRecommendationEngine();
    }

    // Mock notification to the recommendation engine
    private notifyRecommendationEngine(): void {
        console.log(`Browsing history updated for user ${this.userId}:`, this.history);
    }

    // Getter for current history
    public getHistory(): string[] {
        return this.history;
    }
}

// Function to simulate getting recommendations based on user context
function getRecommendations(userId: string): void {
    const userContext = new UserPreferenceContext(userId);
    const browsingContext = new BrowsingHistoryContext(userId);

    // Simulate adding to browsing history
    browsingContext.addToHistory('Laptop');
    browsingContext.addToHistory('Headphones');

    // Simulate updating user preferences
    userContext.updatePreferences({ theme: 'dark', currency: 'EUR' });

    // Output current state of contexts
    console.log('Current User Preferences:', userContext.getPreferences());
    console.log('Current Browsing History:', browsingContext.getHistory());
}

// The main function to execute the example
function main(): void {
    const userId = "user123"; // Example user ID
    getRecommendations(userId); // Retrieve recommendations for the user
}

// Run the main function
main();
