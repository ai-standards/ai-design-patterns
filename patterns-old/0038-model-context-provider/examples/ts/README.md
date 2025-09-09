```markdown
# TypeScript User Preferences and Browsing Behavior Example

This repository contains a TypeScript example that demonstrates a simple architecture for managing user preferences and browsing behavior using context blocks. The design showcases how different components can interact to provide a cohesive user experience. This README will guide you through the architecture, implementation details, and how to extend the example for your own use cases.

## Architecture Overview

The example consists of three main components:

1. **UserPreferences**: This context block manages user preferences, allowing users to update their likes and dislikes.
2. **BrowsingBehavior**: This context block tracks the pages that users visit during their browsing sessions.
3. **ContextProvider**: This component acts as a mediator, coordinating interactions between the `UserPreferences` and `BrowsingBehavior` context blocks.

The architecture follows a simple observer pattern where changes in one context block can trigger updates in another, allowing for a responsive user interface that adapts to user behavior.

## Implementation Details

### UserPreferences

The `UserPreferences` class manages an array of preferences. It provides the following methods:

- `updatePreferences(newPreference: string)`: Adds a new preference and notifies the `ContextProvider` to trigger any related updates.
- `getPreferences()`: Returns the current list of user preferences.

```typescript
class UserPreferences {
    private preferences: string[] = [];

    public updatePreferences(newPreference: string): void {
        this.preferences.push(newPreference);
        ContextProvider.notifyBrowsingBehavior(newPreference);
    }

    public getPreferences(): string[] {
        return this.preferences;
    }
}
```

### BrowsingBehavior

The `BrowsingBehavior` class keeps track of the pages visited by the user. It includes:

- `addPageVisit(page: string)`: Records a new page visit and notifies the `ContextProvider` to update recommendations based on the browsing history.
- `getVisitedPages()`: Returns the list of visited pages.

```typescript
class BrowsingBehavior {
    private visitedPages: string[] = [];

    public addPageVisit(page: string): void {
        this.visitedPages.push(page);
        ContextProvider.notifyRecommendations(this.visitedPages);
    }

    public getVisitedPages(): string[] {
        return this.visitedPages;
    }
}
```

### ContextProvider

The `ContextProvider` serves as a central hub for notifications and user actions. It contains:

- Static instances of `UserPreferences` and `BrowsingBehavior`.
- Notification methods that log changes to the console.
- A method to simulate user actions that demonstrates how the context blocks interact.

```typescript
class ContextProvider {
    private static userPreferences: UserPreferences = new UserPreferences();
    private static browsingBehavior: BrowsingBehavior = new BrowsingBehavior();

    public static notifyBrowsingBehavior(preference: string): void {
        console.log(`New preference added: ${preference}`);
    }

    public static notifyRecommendations(visitedPages: string[]): void {
        console.log(`Updated visited pages: ${visitedPages.join(', ')}`);
    }

    public static simulateUserActions(): void {
        console.log("Simulating user actions...");
        userPreferences.updatePreferences("Electronics");
        browsingBehavior.addPageVisit("Smartphone Page");
        browsingBehavior.addPageVisit("Laptop Page");
    }
}
```

### Main Function

The `main()` function is the entry point of the application, which triggers the simulation of user actions to demonstrate the interaction between the context blocks.

```typescript
function main(): void {
    ContextProvider.simulateUserActions();
}

// Run the main function
main();
```

## Testing

The example includes unit tests for each component using Jest. The tests cover:

- Correct updating of preferences and page visits.
- Handling of edge cases, such as adding `undefined` values.
- Verification that user actions are simulated correctly.

To run the tests, ensure you have Jest installed and execute:

```bash
npm test
```

## Modifying and Extending the Example

You can easily modify or extend this example to fit other use cases:

1. **Adding More Preferences**: Extend the `UserPreferences` class to support categories or types of preferences.
2. **Enhanced Browsing Behavior**: Add functionality to track the time spent on each page or categorize visited pages.
3. **Recommendations Logic**: Implement a more sophisticated recommendation engine based on user preferences and browsing history.

To implement these changes, simply add new methods to the existing classes or create new classes that interact with the `ContextProvider`.

## Conclusion

This example illustrates a straightforward approach to managing user preferences and browsing behavior using TypeScript. By leveraging context blocks and a central provider, you can create a responsive and adaptable user experience. Feel free to explore and expand upon this architecture to suit your application's needs.
```