extends SceneTree

var passed := 0
var failed := 0

func check(label: String, condition: bool):
	if condition:
		passed += 1
		print("PASS: ", label)
	else:
		failed += 1
		print("FAIL: ", label)

func _initialize():
	call_deferred("run_audit")

func run_audit():
	var paths := [
		"res://addons/beehave/nodes/beehave_tree.gd",
		"res://addons/dialogic/Modules/Character/class_dialogic_animation.gd",
		"res://addons/phantom_camera/scripts/phantom_camera/phantom_camera_3d.gd",
		"res://addons/virtual_joystick/virtual_joystick.gd",
		"res://addons/godot_sfxr/SfxrStreamPlayer.gd",
	]
	for path in paths:
		var script = load(path)
		check("load " + path, script != null and script.can_instantiate())
		if script != null and script.can_instantiate():
			var instance = script.new()
			check("instantiate " + path, instance != null)
			if instance is Node:
				instance.free()
	var audio_script = load("res://addons/godot_sfxr/SfxrAudioStream.gd")
	var generator = SfxrGenerator.new()
	for preset in [SfxrGlobals.PRESETS.PICKUP, SfxrGlobals.PRESETS.LASER, SfxrGlobals.PRESETS.EXPLOSION, SfxrGlobals.PRESETS.JUMP, SfxrGlobals.PRESETS.CLICK]:
		var stream = audio_script.new()
		check("audio preset " + str(preset), stream.preset_values(preset))
		generator.build_sample(stream)
		check("audio buffer " + str(preset), stream.data.size() > 0 and stream.mix_rate == 44100)
		print("BUFFER: ", preset, " bytes=", stream.data.size(), " rate=", stream.mix_rate)
	var blackboard = Blackboard.new()
	root.add_child(blackboard)
	blackboard.set_value("audit", 42)
	check("Beehave blackboard set/get", blackboard.get_value("audit") == 42)
	blackboard.erase_value("audit")
	check("Beehave blackboard erase", not blackboard.has_value("audit"))
	var action = BlackboardSetAction.new()
	action.key = "'action_result'"
	action.value = "99"
	root.add_child(action)
	check("Beehave action tick", action.tick(root, blackboard) == BeehaveNode.SUCCESS and blackboard.get_value("action_result") == 99)
	action.free()
	blackboard.free()
	ProjectSettings.set_setting("input_devices/pointing/emulate_mouse_from_touch", false)
	ProjectSettings.set_setting("input_devices/pointing/emulate_touch_from_mouse", true)
	var joystick = load("res://addons/virtual_joystick/virtual_joystick_scene.tscn").instantiate()
	joystick.use_input_actions = false
	root.add_child(joystick)
	var touch = InputEventScreenTouch.new()
	touch.index = 0
	touch.pressed = true
	touch.position = joystick._base.get_global_rect().get_center()
	joystick._input(touch)
	check("VirtualJoystick deadzone", not joystick.is_pressed and joystick._touch_index == 0 and joystick.output == Vector2.ZERO)
	var drag = InputEventScreenDrag.new()
	drag.index = 0
	drag.position = touch.position + Vector2(50, 0)
	joystick._input(drag)
	check("VirtualJoystick drag", joystick.output.x > 0)
	touch.pressed = false
	joystick._input(touch)
	check("VirtualJoystick release", not joystick.is_pressed and joystick.output == Vector2.ZERO)
	joystick.free()
	print("RESULT: passed=", passed, " failed=", failed)
	quit(1 if failed else 0)
