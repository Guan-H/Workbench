package com.privatespace.modules.english.service.impl;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.CourseDtos.*;
import com.privatespace.modules.english.entity.CourseEntity;
import com.privatespace.modules.english.entity.CourseProgressEntity;
import com.privatespace.modules.english.mapper.CourseMapper;
import com.privatespace.modules.english.service.CourseService;
import com.privatespace.modules.english.util.StudyIdentity;

@Service
public class CourseServiceImpl implements CourseService {
    private final CourseMapper mapper;
    private final ObjectMapper json;

    public CourseServiceImpl(CourseMapper mapper, ObjectMapper json) {
        this.mapper = mapper;
        this.json = json;
    }

    private State initial() {
        return new State("article", Map.of(), Set.of(), Set.of(), false, false);
    }

    private CourseEntity course(String id) {
        var course = mapper.course(id);
        if (course == null) throw new ApiException(404, "COURSE_NOT_FOUND", "阅读材料不存在。");
        return course;
    }

    private State state(CourseProgressEntity progress) {
        return progress == null ? initial() : json.readValue(progress.payload(), State.class);
    }

    private Summary summary(CourseEntity course, CourseProgressEntity progress) {
        State state = state(progress);
        return new Summary(course.id(), course.title(), course.focus(), course.source(),
                progress == null ? "0" : Long.toString(progress.revision()), state.position(),
                state.completed(), state.answers().size(), state.marked().size() + state.wrong().size(), state.favorite(), course.originKind());
    }

    public Page list(int page, String filter) {
        if (page < 1 || page > 1000000) throw invalid();
        if (!Set.of("all", "favorite", "review").contains(filter)) throw invalid();
        return new Page(mapper.list((page - 1) * 10, filter).stream()
                .map(course -> summary(course, mapper.progress(course.id()))).toList(), mapper.total(filter), page);
    }

    public SentencePage sentences(int page, boolean markedOnly) {
        if (page < 1 || page > 1000000) throw invalid();
        return new SentencePage(mapper.sentences((page - 1) * 10, markedOnly).stream()
                .map(row -> new SentenceEntry(row.courseId(), row.title(), row.sentenceIndex(), row.text(), row.marked()))
                .toList(), mapper.sentenceTotal(markedOnly), page);
    }

    public Detail detail(String id) {
        return view(course(id), mapper.progress(id));
    }

    private Detail view(CourseEntity course, CourseProgressEntity progress) {
        Content content = json.readValue(course.payload(), Content.class);
        State state = state(progress);
        var questions = java.util.stream.IntStream.range(0, content.questions().size()).mapToObj(index -> {
            Question question = content.questions().get(index);
            Integer selected = state.answers().get(Integer.toString(index));
            return new QuestionView(question.prompt(), question.options(), selected,
                    selected == null ? null : question.answer(), selected == null ? null : question.explanation(),
                    selected == null ? null : question.evidence());
        }).toList();
        return new Detail(summary(course, progress), content.article(), content.sentences(), content.words(),
                questions, state.marked(), state.wrong(), content.origin());
    }

    /** The per-course progress lock makes conditional updates and retry receipts atomic. */
    @Transactional
    public Detail change(String id, Change request, String operation) {
        CourseEntity course = course(id);
        Content content = json.readValue(course.payload(), Content.class);
        mapper.initialize(id, json.writeValueAsString(initial()));
        CourseProgressEntity progress = mapper.lock(id);
        String hash = StudyIdentity.hash(json.writeValueAsString(request));
        var receipt = mapper.operation(id, operation);
        if (receipt != null) {
            if (!receipt.requestHash().equals(hash)) {
                throw new ApiException(409, "COURSE_OPERATION_REUSED", "操作编号已用于其他内容。");
            }
            return json.readValue(receipt.result(), Detail.class);
        }
        if (!Long.toString(progress.revision()).equals(request.baseRevision())) {
            throw new ApiException(409, "COURSE_CHANGED", "学习记录已在其他页面更新，请重新读取后核对。");
        }
        State previous = state(progress);
        var answers = new HashMap<>(previous.answers());
        var marked = new HashSet<>(previous.marked());
        var wrong = new HashSet<>(previous.wrong());
        String position = previous.position();
        boolean completed = previous.completed();
        boolean favorite = previous.favorite();
        switch (request.action()) {
            case "position" -> {
                position = request.position();
                boolean valid = "article".equals(position) || "practice".equals(position);
                for (int index = 0; index < content.sentences().size(); index++) {
                    valid |= ("sentence-" + index).equals(position);
                }
                if (!valid) throw invalid();
            }
            case "answer" -> {
                int index = index(request.index(), content.questions().size());
                Question question = content.questions().get(index);
                int choice = index(request.choice(), question.options().size());
                answers.put(Integer.toString(index), choice);
                if (choice == question.answer()) wrong.remove(index);
                else wrong.add(index);
                position = "practice";
            }
            case "mark" -> {
                int index = index(request.index(), content.sentences().size());
                if (request.marked() == null) throw invalid();
                if (request.marked()) marked.add(index);
                else marked.remove(index);
            }
            case "finish" -> {
                if (answers.size() != content.questions().size()) {
                    throw new ApiException(409, "COURSE_NOT_FINISHED", "请先完成本课全部理解题。");
                }
                completed = true;
            }
            case "favorite" -> {
                if (request.favorite() == null) throw invalid();
                favorite = request.favorite();
            }
            default -> throw invalid();
        }
        mapper.save(id, json.writeValueAsString(new State(position, answers, marked, wrong, completed, favorite)));
        Detail result = view(course, mapper.progress(id));
        mapper.receipt(id, operation, hash, json.writeValueAsString(result));
        return result;
    }

    private int index(Integer index, int count) {
        if (index == null || index < 0 || index >= count) throw invalid();
        return index;
    }

    private ApiException invalid() {
        return new ApiException(400, "INVALID_COURSE_REQUEST", "请核对阅读位置、题目和选项。");
    }
}
