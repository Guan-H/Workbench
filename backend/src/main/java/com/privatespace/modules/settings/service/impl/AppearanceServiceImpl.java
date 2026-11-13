package com.privatespace.modules.settings.service.impl;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.settings.dto.AppearanceDtos.*;
import com.privatespace.modules.settings.mapper.AppearanceMapper;
import com.privatespace.modules.settings.service.AppearanceService;
import tools.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.*;
import java.util.*;

@Service
public class AppearanceServiceImpl implements AppearanceService {
    private final AppearanceMapper mapper;
    private final ObjectMapper json;
    public AppearanceServiceImpl(AppearanceMapper mapper, ObjectMapper json) {
        this.mapper = mapper;
        this.json = json;
    }
    private Settings defaults() {
        return new Settings(null,null,50,100,50,50,44,"#526b83","paper","paper",21,55);
    }
    @Transactional
    public Saved read() {
        long version = mapper.lock();
        return new Saved(version, version == 0 ? defaults() : json.readValue(mapper.settings(), Settings.class));
    }
    @Transactional
    public Saved save(Write request) {
        if (request == null || request.settings() == null) throw invalid();
        Settings s = request.settings();
        if (s.accent()==null || s.notes()==null || s.mindmap()==null) throw invalid();
        if (!List.of("#526b83","#8b5f47","#7a6197","#527b71").contains(s.accent())
                || !List.of("paper","soft").contains(s.notes()) || !List.of("paper","soft").contains(s.mindmap())
                || !range(s.desktopX(),100) || !range(s.desktopY(),100)
                || !range(s.mobileX(),100) || !range(s.mobileY(),100)
                || !range(s.overlay(),90) || s.overlay()<20
                || !range(s.notesTransparency(),80) || !range(s.mindmapTransparency(),80)) throw invalid();
        long current = mapper.lock();
        if (current != request.version()) throw new ApiException(409,"APPEARANCE_CHANGED","其他设备已更新外观，请重新读取后再应用。");
        for (String id : new String[]{s.desktop(),s.mobile()}) if (id != null) image(id);
        mapper.save(json.writeValueAsString(s));
        return new Saved(current+1,s);
    }
    private boolean range(int value,int max) { return value>=0 && value<=max; }
    private ApiException invalid() { return new ApiException(400,"INVALID_APPEARANCE","背景或外观参数无效。"); }
    @Transactional
    public Image upload(MultipartFile file) {
        if (file.isEmpty() || file.getSize()>8*1024*1024) throw invalid();
        mapper.lock();
        if (mapper.count()>=100) throw new ApiException(409,"BACKGROUND_LIMIT","背景图库已达到 100 张上限。");
        try (var input = ImageIO.createImageInputStream(file.getInputStream())) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw invalid();
            var reader = readers.next();
            try {
                reader.setInput(input);
                String format = reader.getFormatName();
                if (!format.equalsIgnoreCase("jpeg") && !format.equalsIgnoreCase("png")) throw invalid();
                int width=reader.getWidth(0),height=reader.getHeight(0);
                if (width<1 || height<1 || (long)width*height>24000000) throw invalid();
                BufferedImage source=reader.read(0);
                double scale=Math.min(1,2560.0/Math.max(width,height));
                BufferedImage target=new BufferedImage(Math.max(1,(int)(width*scale)),Math.max(1,(int)(height*scale)),BufferedImage.TYPE_INT_RGB);
                var g=target.createGraphics();
                try {
                    g.setColor(java.awt.Color.WHITE);
                    g.fillRect(0,0,target.getWidth(),target.getHeight());
                    g.drawImage(source,0,0,target.getWidth(),target.getHeight(),null);
                } finally { g.dispose(); }
                var output=new ByteArrayOutputStream();
                ImageIO.write(target,"jpeg",output);
                String id=UUID.randomUUID().toString();
                mapper.insertImage(id,output.toByteArray());
                return new Image(id);
            } finally { reader.dispose(); }
        } catch (IOException e) { throw invalid(); }
    }
    public byte[] image(String id) {
        if (id==null || !id.matches("[a-f0-9-]{36}")) throw invalid();
        var resource=mapper.image(id);
        if (resource==null) throw new ApiException(404,"BACKGROUND_NOT_FOUND","背景图片不存在。");
        return resource.image();
    }
    public List<String> listImages() { return mapper.listImages(); }
}
