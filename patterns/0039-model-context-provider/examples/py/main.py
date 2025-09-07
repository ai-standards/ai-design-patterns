from typing import Dict, List, Any

# Interface for a Context Provider
class ContextProvider:
    def get_context(self, user_id: str) -> Dict[str, Any]:
        raise NotImplementedError("Subclasses should implement this method.")

# NutritionContextProvider class to fetch user dietary preferences
class NutritionContextProvider(ContextProvider):
    def get_context(self, user_id: str) -> Dict[str, Any]:
        # Mocked user dietary preferences for the example
        return {
            'user_id': user_id,
            'dietary_preferences': 'Vegetarian',
            'allergies': ['Nuts']
        }

# FitnessContextProvider class to fetch user physical activity data
class FitnessContextProvider(ContextProvider):
    def get_context(self, user_id: str) -> Dict[str, Any]:
        # Mocked user fitness data for the example
        return {
            'user_id': user_id,
            'activity_level': 'Moderate',
            'last_workout': '2023-10-01'
        }

# MentalWellnessContextProvider class to fetch user mental wellness data
class MentalWellnessContextProvider(ContextProvider):
    def get_context(self, user_id: str) -> Dict[str, Any]:
        # Mocked user mental wellness data for the example
        return {
            'user_id': user_id,
            'stress_level': 'Low',
            'mood': 'Happy'
        }

# ContextManager class to manage the context providers
class ContextManager:
    def __init__(self) -> None:
        self.nutrition_provider = NutritionContextProvider()
        self.fitness_provider = FitnessContextProvider()
        self.mental_wellness_provider = MentalWellnessContextProvider()

    # Method to get all context data for a user
    def get_context(self, user_id: str) -> Dict[str, Any]:
        return {
            'nutrition': self.nutrition_provider.get_context(user_id),
            'fitness': self.fitness_provider.get_context(user_id),
            'mental_wellness': self.mental_wellness_provider.get_context(user_id)
        }

# Function to simulate the main application logic
def main() -> None:
    user_id = '12345'  # Example user ID for testing
    context_manager = ContextManager()
    
    # Fetch and log the context data for the user
    user_context = context_manager.get_context(user_id)
    print('User Context:', user_context)

# Run the main function to see the output
if __name__ == "__main__":
    main()
