// main.ts

// Interface for a Context Provider
interface ContextProvider {
    getContext(userId: string): object;
}

// NutritionContextProvider class to fetch user dietary preferences
class NutritionContextProvider implements ContextProvider {
    getContext(userId: string): object {
        // Mocked user dietary preferences for the example
        return {
            userId: userId,
            dietaryPreferences: 'Vegetarian',
            allergies: ['Nuts']
        };
    }
}

// FitnessContextProvider class to fetch user physical activity data
class FitnessContextProvider implements ContextProvider {
    getContext(userId: string): object {
        // Mocked user fitness data for the example
        return {
            userId: userId,
            activityLevel: 'Moderate',
            lastWorkout: '2023-10-01'
        };
    }
}

// MentalWellnessContextProvider class to fetch user mental wellness data
class MentalWellnessContextProvider implements ContextProvider {
    getContext(userId: string): object {
        // Mocked user mental wellness data for the example
        return {
            userId: userId,
            stressLevel: 'Low',
            mood: 'Happy'
        };
    }
}

// ContextManager class to manage the context providers
class ContextManager {
    private nutritionProvider: NutritionContextProvider;
    private fitnessProvider: FitnessContextProvider;
    private mentalWellnessProvider: MentalWellnessContextProvider;

    constructor() {
        this.nutritionProvider = new NutritionContextProvider();
        this.fitnessProvider = new FitnessContextProvider();
        this.mentalWellnessProvider = new MentalWellnessContextProvider();
    }

    // Method to get all context data for a user
    getContext(userId: string): object {
        return {
            nutrition: this.nutritionProvider.getContext(userId),
            fitness: this.fitnessProvider.getContext(userId),
            mentalWellness: this.mentalWellnessProvider.getContext(userId)
        };
    }
}

// Function to simulate the main application logic
function main() {
    const userId = '12345'; // Example user ID for testing
    const contextManager = new ContextManager();
    
    // Fetch and log the context data for the user
    const userContext = contextManager.getContext(userId);
    console.log('User Context:', userContext);
}

// Run the main function to see the output
main();
