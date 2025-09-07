import pytest
from unittest.mock import patch
from main import myFunction, AnotherClass

def test_my_function_should_return_correct_result_for_valid_input():
    input_value = 5
    expected_output = 25
    result = myFunction(input_value)
    assert result == expected_output

def test_my_function_should_handle_negative_input():
    input_value = -3
    expected_output = 9
    result = myFunction(input_value)
    assert result == expected_output

def test_my_function_should_throw_error_for_non_numeric_input():
    input_value = 'string'
    with pytest.raises(ValueError, match='Input must be a number'):
        myFunction(input_value)

def test_my_function_should_return_zero_when_input_is_zero():
    input_value = 0
    expected_output = 0
    result = myFunction(input_value)
    assert result == expected_output

@pytest.fixture
def another_class_instance():
    return AnotherClass()

def test_another_class_should_initialize_with_default_values(another_class_instance):
    assert another_class_instance.value == 0

def test_another_class_should_update_value_correctly(another_class_instance):
    another_class_instance.updateValue(10)
    assert another_class_instance.value == 10

def test_another_class_should_throw_error_when_updating_value_to_negative_number(another_class_instance):
    with pytest.raises(ValueError, match='Value cannot be negative'):
        another_class_instance.updateValue(-5)

def test_another_class_should_return_correct_string_representation(another_class_instance):
    another_class_instance.updateValue(15)
    assert another_class_instance.toString() == 'Value is 15'
