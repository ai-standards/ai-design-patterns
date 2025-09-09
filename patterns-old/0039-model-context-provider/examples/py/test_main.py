import pytest
from unittest.mock import patch
from main import ContextManager

@pytest.fixture
def context_manager():
    return ContextManager()

def test_fetch_complete_context_data_for_valid_user_id(context_manager):
    user_id = '12345'
    context = context_manager.get_context(user_id)

    assert context == {
        'nutrition': {
            'userId': user_id,
            'dietaryPreferences': 'Vegetarian',
            'allergies': ['Nuts']
        },
        'fitness': {
            'userId': user_id,
            'activityLevel': 'Moderate',
            'lastWorkout': '2023-10-01'
        },
        'mentalWellness': {
            'userId': user_id,
            'stressLevel': 'Low',
            'mood': 'Happy'
        }
    }

def test_fetch_complete_context_data_for_another_user_id(context_manager):
    user_id = '67890'
    context = context_manager.get_context(user_id)

    assert context == {
        'nutrition': {
            'userId': user_id,
            'dietaryPreferences': 'Vegetarian',
            'allergies': ['Nuts']
        },
        'fitness': {
            'userId': user_id,
            'activityLevel': 'Moderate',
            'lastWorkout': '2023-10-01'
        },
        'mentalWellness': {
            'userId': user_id,
            'stressLevel': 'Low',
            'mood': 'Happy'
        }
    }

def test_handle_empty_user_id_gracefully(context_manager):
    user_id = ''
    context = context_manager.get_context(user_id)

    assert context == {
        'nutrition': {
            'userId': user_id,
            'dietaryPreferences': 'Vegetarian',
            'allergies': ['Nuts']
        },
        'fitness': {
            'userId': user_id,
            'activityLevel': 'Moderate',
            'lastWorkout': '2023-10-01'
        },
        'mentalWellness': {
            'userId': user_id,
            'stressLevel': 'Low',
            'mood': 'Happy'
        }
    }
