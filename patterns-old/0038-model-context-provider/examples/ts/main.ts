// main.ts

// UserPreferences context block to manage user likes and dislikes
class UserPreferences {
    private preferences: string[] = [];

    // Update user preferences and notify other context blocks
    public updatePreferences(newPreference: string): void {
        this.preferences.push(newPreference);
        ContextProvider.notifyBrowsingBehavior(newPreference);
    }

    public getPreferences(): string[] {
        return this.preferences;
    }
}

// BrowsingBehavior context block to manage user browsing history
class BrowsingBehavior {
    private visitedPages: string[] = [];

    // Add a page visit and notify recommendations
    public addPageVisit(page: string): void {
        this.visitedPages.push(page);
        ContextProvider.notifyRecommendations(this.visitedPages);
    }

    public getVisitedPages(): string[] {
        return this.visitedPages;
    }
}

// ContextProvider to handle synchronization between context blocks
class ContextProvider {
    private static userPreferences: UserPreferences = new UserPreferences();
    private static browsingBehavior: BrowsingBehavior = new BrowsingBehavior();

    // Notify browsing behavior of a new preference
    public static notifyBrowsingBehavior(preference: string): void {
        console.log(`New preference added: ${preference}`);
    }

    // Notify recommendations based on browsing behavior
    public static notifyRecommendations(visitedPages: string[]): void {
        console.log(`Updated visited pages: ${visitedPages.join(', ')}`);
        // Here, we could add logic to generate recommendations based on visited pages
        // For simplicity, we just log the pages to the console
    }

    // Function to simulate user actions
    public static simulateUserActions(): void {
        console.log("Simulating user actions...");
        userPreferences.updatePreferences("Electronics");
        browsingBehavior.addPageVisit("Smartphone Page");
        browsingBehavior.addPageVisit("Laptop Page");
    }
}

// The main function to run our example
function main(): void {
    // Simulate user actions to see how context blocks interact
    ContextProvider.simulateUserActions();
}

// Run the main function
main();
