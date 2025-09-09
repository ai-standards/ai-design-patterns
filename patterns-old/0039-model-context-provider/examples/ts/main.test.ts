// main.test.ts

import { ContextManager } from './main'; // Import the ContextManager class from main.ts

describe('ContextManager', () => {
    let contextManager: ContextManager;

    beforeEach(() => {
        contextManager = new ContextManager(); // Initialize a new instance before each test
    });

    // Test to check if the context data is fetched correctly for a valid user ID
    test('should fetch complete context data for a valid user ID', () => {
        const userId = '12345';
        const context = contextManager.getContext(userId);

        expect(context).toEqual({
            nutrition: {
                userId: userId,
                dietaryPreferences: 'Vegetarian',
                allergies: ['Nuts']
            },
            fitness: {
                userId: userId,
                activityLevel: 'Moderate',
                lastWorkout: '2023-10-01'
            },
            mentalWellness: {
                userId: userId,
                stressLevel: 'Low',
                mood: 'Happy'
            }
        });
    });

    // Test to check if the context data is fetched correctly for another valid user ID
    test('should fetch complete context data for another user ID', () => {
        const userId = '67890';
        const context = contextManager.getContext(userId);

        expect(context).toEqual({
            nutrition: {
                userId: userId,
                dietaryPreferences: 'Vegetarian',
                allergies: ['Nuts']
            },
            fitness: {
                userId: userId,
                activityLevel: 'Moderate',
                lastWorkout: '2023-10-01'
            },
            mentalWellness: {
                userId: userId,
                stressLevel: 'Low',
                mood: 'Happy'
            }
        });
    });

    // Edge case test: Check how the system behaves with an empty user ID
    test('should handle empty user ID gracefully', () => {
        const userId = '';
        const context = contextManager.getContext(userId);

        expect(context).toEqual({
            nutrition: {
                userId: userId,
                dietaryPreferences: 'Vegetarian',
                allergies: ['Nuts']
            },
            fitness: {
                userId: userId,
                activityLevel: 'Moderate',
                lastWorkout: '2023-10-01'
            },
            mentalWellness: {
                userId: userId,
                stressLevel: 'Low',
                mood: 'Happy'
            }
        });
    });
});
