from PIL import Image

qr = Image.open('/tmp/mobily-pair.png').convert('RGB').resize((400, 400), Image.Resampling.NEAREST)
canvas = Image.new('RGB', (1280, 960), 'white')
canvas.paste(qr, (120, 550))
canvas.save('/tmp/mobily-camera.png')
